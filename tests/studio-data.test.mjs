import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Compile browser-independent TypeScript with the repository's pinned compiler.
async function moduleURL(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(imports)) source = source.replace(`from '${from}'`, `from '${to}'`);
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const rendererURL = await moduleURL('../lib/studio-renderer.ts');
const { DEFAULT_STUDIO_DOCUMENT, renderPoster } = await import(rendererURL);
const { parseDraft } = await import(await moduleURL('../lib/studio-drafts.ts', { './studio-renderer': rendererURL }));
function draft() {
  return { version: 1, document: { ...DEFAULT_STUDIO_DOCUMENT, title: 'Robe bleu ciel', price: '85' }, source: '', sourceName: '', reference: '', referenceName: '', prompt: '', date: '2026-11-18', project: 'FASTWAY' };
}

test('an incomplete draft remains editable and roundtrips through JSON', () => {
  const input = draft(); input.document.title = ''; input.document.price = ''; input.date = '';
  assert.deepEqual(parseDraft(JSON.parse(JSON.stringify(input))), input);
});
test('an invalid price remains in the draft so the user can correct it after reloading', () => {
  const input = draft(); input.document.price = '123456789012345678901234567890';
  assert.equal(parseDraft(JSON.parse(JSON.stringify(input))).document.price, input.document.price);
});
test('draft dates must exist, including leap-day validation', () => {
  for (const date of ['2026-02-31', '2026-02-29', '2026-04-31', '2026-00-10', '2026-13-01']) {
    assert.throws(() => parseDraft({ ...draft(), date }), /brouillon invalides/, date);
  }
  for (const date of ['2024-02-29', '2026-02-28', '2026-12-31']) assert.equal(parseDraft({ ...draft(), date }).date, date);
});
test('an imported title cannot exceed the calendar API limit', () => {
  const input = draft(); input.document.title = 'A'.repeat(151);
  assert.throws(() => parseDraft(input), /Texte invalide/);
  input.document.title = 'A'.repeat(150); assert.equal(parseDraft(input).document.title.length, 150);
});
test('imported strings obey the editor field limits', () => {
  for (const [field, limit] of [['features', 600], ['headline', 100], ['subheadline', 100], ['phone', 100], ['deliveryTitle', 100], ['deliveryRoute', 100], ['cta', 100]]) {
    const input = draft(); input.document[field] = 'A'.repeat(limit + 1);
    assert.throws(() => parseDraft(input), /Texte invalide/, field);
  }
});
test('non-object document arrays are rejected', () => {
  assert.throws(() => parseDraft({ ...draft(), document: [] }), /Format de brouillon/);
});
test('external image URLs and malformed thumbnail modes are rejected', () => {
  const input = draft(); input.document.photo = 'https://example.org/product.png';
  assert.throws(() => parseDraft(input), /Image invalide/);
  input.document.photo = ''; input.document.thumbnailMode = 'arbitrary';
  assert.throws(() => parseDraft(input), /Mode miniature/);
});
test('prices that round to a different monetary amount cannot be rendered', async () => {
  const original = globalThis.Image;
  globalThis.Image = class {
    naturalWidth = 100; naturalHeight = 100;
    set src(_value) { queueMicrotask(() => this.onload()); }
  };
  try {
    for (const price of ['0.001', '1.005', '-1', '1000000', 'Infinity', '0x10', '   ']) {
      await assert.rejects(renderPoster({}, { ...DEFAULT_STUDIO_DOCUMENT, price }), /prix/, price);
    }
  } finally { globalThis.Image = original; }
});
