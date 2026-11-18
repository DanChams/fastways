import test from 'node:test';
import assert from 'node:assert/strict';
import { InvalidPost, parsePost, validPostDate, validPostId } from './post-validation.ts';

const id = 'f22c1025-7722-4e13-ab9e-78299f211ee4';
const photo = { id, name: 'produit.png', url: `/api/files?id=${id}`, type: 'image/png', size: 1024 };
const post = overrides => ({ id, title: 'Produit', date: '2026-11-18', project: 'FASTWAY', status: 'En attente', caption: '', comment: '', drive: '', assets: [photo], thumbnail: photo, ...overrides });

test('calendar dates reject rollover, invalid month and year zero while preserving leap years', () => {
  for (const date of ['2026-02-31', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '0000-01-01', '2026-1-01', null, 20261118]) assert.equal(validPostDate(date), false);
  for (const date of ['2024-02-29', '2026-11-18', '0001-01-01', '2000-02-29']) assert.equal(validPostDate(date), true);
});

test('normal editor posts preserve metadata and normalize stored fields in the response', () => {
  const result = parsePost(post({ title: '  Produit  ', project: '  ', updated: 'ignored' }));
  assert.equal(result.title, 'Produit'); assert.equal(result.project, 'FASTWAY'); assert.equal(result.updated, '');
  assert.deepEqual(result.assets, [photo]); assert.deepEqual(result.thumbnail, photo);
});

test('malformed JSON values and nested asset types are validation errors rather than crashes', () => {
  const cases = [null, [], 'text', 3, post({ title: 42 }), post({ project: {} }), post({ caption: [] }), post({ assets: [null] }), post({ assets: [{ ...photo, size: '1024' }] }), post({ thumbnail: 5 }), post({ date: '2026-02-31' })];
  for (const value of cases) assert.throws(() => parsePost(value), InvalidPost);
});

test('text bounds match the editor and are never silently truncated', () => {
  for (const [field, size] of [['title', 151], ['project', 81], ['caption', 20001], ['comment', 20001], ['drive', 2049]]) assert.throws(() => parsePost(post({ [field]: 'x'.repeat(size) })), InvalidPost);
  assert.equal(parsePost(post({ caption: 'x'.repeat(20000) })).caption.length, 20000);
});

test('file URLs must match their IDs and metadata; nonimage thumbnail rejected', () => {
  for (const change of [{ url: '/api/files?id=bad' }, { id: 'bad' }, { url: 'https://external.example/image.png' }, { size: -1 }, { size: 1.5 }, { size: 26 * 1024 * 1024 }, { type: '' }]) assert.throws(() => parsePost(post({ assets: [{ ...photo, ...change }] })), InvalidPost);
  assert.throws(() => parsePost(post({ assets: Array(31).fill(photo) })), InvalidPost);
  assert.throws(() => parsePost(post({ thumbnail: { ...photo, type: 'application/pdf' } })), InvalidPost);
  assert.equal(parsePost(post({ assets: [{ ...photo, type: 'application/pdf' }], thumbnail: null })).assets[0].type, 'application/pdf');
});

test('legacy template and fallback post IDs continue to work', () => {
  const template = { id: 'template', name: 'Exemple.jpg', url: '/template-post.jpg', type: 'image/jpeg', size: 0 };
  for (const id of ['template-example', 'a'.repeat(32), 'legacy-post-name']) assert.equal(parsePost(post({ id, assets: [template], thumbnail: template })).id, id);
  for (const value of [null, {}, '', '  ', 42, 'a'.repeat(201)]) assert.equal(validPostId(value), false);
});

test('Google Drive uses exact HTTPS host rather than deceptive URLs', () => {
  for (const drive of ['https://drive.google.com/file/d/abc', 'https://docs.google.com/document/d/abc']) assert.equal(parsePost(post({ drive })).drive, drive);
  for (const drive of ['http://drive.google.com/file/d/abc', 'https://drive.google.com.evil.example/file', 'https://drive.google.com@evil.example/file', 'https://user:password@drive.google.com/file', 'https://drive.google.com:8443/file']) assert.throws(() => parsePost(post({ drive })), InvalidPost);
});
