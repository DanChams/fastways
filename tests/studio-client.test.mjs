import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, keepGeneration, keepSave, readGeneration, readSave, StudioRequestError, studioResponse } from '../lib/studio-client.ts';

test('HTML auth redirects show a useful session message rather than JSON syntax errors', async () => {
  const response = new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } });
  Object.defineProperty(response, 'redirected', { value: true });
  await assert.rejects(studioResponse(response), e => e instanceof StudioRequestError && e.code === 'AUTH_REQUIRED' && /session/.test(e.message));
});
test('interrupted JSON remains retryable with the same operation', async () => {
  await assert.rejects(studioResponse(new Response('{', { headers: { 'content-type': 'application/json' } })), e => e.code === 'INVALID_RESPONSE' && e.jobState === undefined);
});
test('failed, pending and indeterminate generation replies keep their recovery semantics', async () => {
  for (const state of ['failed', 'pending', 'indeterminate']) {
    await assert.rejects(studioResponse(Response.json({ error: 'Erreur contrôlée', code: 'GENERATION_STATUS', jobState: state, retryable: state === 'failed' }, { status: 409 })), e => e.jobState === state && e.retryable === (state === 'failed'));
  }
});
test('calendar arrays and imported assets remain readable without weakening response validation', async () => {
  assert.deepEqual(await studioResponse(Response.json([{ id: 'existing-post' }])), [{ id: 'existing-post' }]);
  await assert.rejects(studioResponse(Response.json(null)), e => e.code === 'INVALID_RESPONSE');
});
test('operation journals survive reload, preserve partial uploads, and never contain image data', async () => {
  const values = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) } });
  try {
    const signature = await fingerprint(['image-originale', 'ambiance', 'texte']);
    const generation = { fingerprint: signature, key: 'f22c1025-7722-4e13-ab9e-78299f211ee4', retry: true };
    keepGeneration(generation); assert.deepEqual(readGeneration(), generation);
    const asset = { id: 'f22c1025-7722-4e13-ab9e-78299f211ee4', url: '/api/files?id=f22c1025-7722-4e13-ab9e-78299f211ee4', type: 'image/png', size: 1234, name: 'affiche.png' };
    const save = { fingerprint: signature, id: generation.key, asset };
    keepSave(save); assert.deepEqual(readSave(), save); assert.equal(readSave().thumbnail, undefined);
    assert.notEqual(await fingerprint(['autre-image', 'ambiance', 'texte']), signature);
    assert.ok([...values.values()].every(v => !v.includes('image-originale') && !v.includes('base64')));
    values.set('fastway-save-operation', JSON.stringify({ ...save, asset: { ...asset, url: 'https://example.com/fake.png' } }));
    assert.equal(readSave(), null);
  } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original); else delete globalThis.sessionStorage;
  }
});
