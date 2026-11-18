import test from 'node:test';
import assert from 'node:assert/strict';
import { appendGenerationImages, boundedBody, generationPrompt, localRequest, validIdempotencyKey, validImageSignature } from './studio-image-server.ts';

test('image format must match actual file signature; SVG and false PNG are rejected', () => {
  assert.equal(validImageSignature(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), 'image/png'), true);
  assert.equal(validImageSignature(Uint8Array.of(255, 216, 255, 224), 'image/jpeg'), true);
  assert.equal(validImageSignature(new TextEncoder().encode('RIFF1234WEBP'), 'image/webp'), true);
  assert.equal(validImageSignature(new TextEncoder().encode('<svg>'), 'image/png'), false);
  assert.equal(validImageSignature(new TextEncoder().encode('<svg>'), 'image/svg+xml'), false);
  assert.equal(validImageSignature(Uint8Array.of(255, 216, 255), 'image/png'), false);
});

test('anonymous generation bypass applies only to loopback hosts', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(localRequest(`http://${host}:5173`), true);
  for (const host of ['localhost.example.com', 'fastway.example.com', '127.0.0.1.example.com']) assert.equal(localRequest(`https://${host}`), false);
});

test('idempotency key rejects arbitrary settings paths', () => {
  assert.equal(validIdempotencyKey('f22c1025-7722-4e13-ab9e-78299f211ee4'), true);
  assert.equal(validIdempotencyKey('studio-ai:quota:global:2026-11-18'), false);
  assert.equal(validIdempotencyKey(''), false);
});

test('body reader caps chunked payloads and cancels overflow', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(Uint8Array.of(1, 2, 3)); c.enqueue(Uint8Array.of(4, 5)); }, cancel() { cancelled = true; } });
  await assert.rejects(boundedBody(stream, 4), RangeError);
  assert.equal(cancelled, true);
  const small = new ReadableStream({ start(c) { c.enqueue(Uint8Array.of(1, 2)); c.enqueue(Uint8Array.of(3)); c.close(); } });
  assert.deepEqual(await boundedBody(small, 3), Uint8Array.of(1, 2, 3));
});

test('visual transposition uploads style first and unmodified product second', async () => {
  const product = new File(['product bytes'], 'product.png', { type: 'image/png' });
  const reference = new File(['style bytes'], 'style.jpg', { type: 'image/jpeg' });
  const withReference = new FormData();
  appendGenerationImages(withReference, product, reference);
  assert.equal(withReference.has('image'), false);
  const images = withReference.getAll('image[]');
  assert.equal(images.length, 2);
  assert.equal(images[0].name, 'style.jpg');
  assert.equal(images[1].name, 'product.png');
  assert.equal(await images[1].text(), 'product bytes');
  const single = new FormData();
  appendGenerationImages(single, product, null);
  assert.equal(single.get('image').name, 'product.png');
  assert.equal(single.has('image[]'), false);
});

test('transposition prompt fixes image roles and prohibits redesign and added graphics', () => {
  const prompt = generationPrompt('  Terrasse lumineuse  ', true);
  assert.match(prompt, /IMAGE 1 is ONLY the art-direction reference/);
  assert.match(prompt, /IMAGE 2 is the STRICT PRODUCT reference/);
  assert.match(prompt, /Never redesign, recolor, reshape or stylize/);
  assert.match(prompt, /no advertising text, price, additional icons, pictograms/);
  assert.ok(prompt.endsWith('Terrasse lumineuse'));
  assert.doesNotMatch(generationPrompt('Salon clair', false), /IMAGE 2/);
});

// The following tests call the same injected service used by the real route.
// SQLite executes the actual SQL and the provider is replaced without credentials
// or billable traffic. The bucket tracks written files and ambiguous write errors.
import { DatabaseSync } from 'node:sqlite';
import { createStudioImageService, LEGACY_IMAGE_KEY_BINDING, resolveImageApiKey } from './studio-image-server.ts';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
function setup({ key = 'test-fixture-key', user = 'local-user', provider, failPut = false, writeThenFail = false, failDone = false } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const files = new Map();
  const calls = [];
  const DB = { prepare(query) { return { bind(...values) { return {
    async run() {
      if (failDone && query.startsWith('UPDATE') && JSON.parse(values[0]).state === 'done') throw new Error('Tracking unavailable');
      return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } };
    },
    async first() { return sql.prepare(query).get(...values) || null; },
  }; } }; } };
  const BUCKET = {
    async put(id, data) {
      if (writeThenFail) { files.set(id, new Uint8Array(data)); throw new Error('Response lost after write'); }
      if (failPut) throw new Error('Write refused');
      files.set(id, new Uint8Array(data));
    },
    async head(id) { return files.has(id) ? { key: id, size: files.get(id).byteLength } : null; },
  };
  const config = { key, model: 'gpt-image-1.5' };
  const service = createStudioImageService({ settings: () => config, identity: async () => user, storage: () => ({ DB, BUCKET }), now: () => new Date('2026-11-18T14:00:00Z'), fetch: async (...args) => { calls.push(args); return provider ? provider(...args) : Response.json({ data: [{ b64_json: png.toString('base64') }] }); } });
  return { ...service, calls, sql, files, config, close() { sql.close(); } };
}
function generationRequest(id = 'f22c1025-7722-4e13-ab9e-78299f211ee4', { reference = false, image = png, prompt = 'Salon clair', origin } = {}) {
  const form = new FormData();
  form.set('image', new File([image], 'product.png', { type: 'image/png' })); form.set('prompt', prompt);
  if (reference) form.set('reference', new File([png], 'style.png', { type: 'image/png' }));
  return new Request('http://localhost/api/studio-image', { method: 'POST', headers: { 'Idempotency-Key': id, ...(origin ? { Origin: origin } : {}) }, body: form });
}

test('key resolver uses only known aliases with explicit precedence', () => {
  assert.equal(resolveImageApiKey({ IMAGE_API_KEY: 'primary', OPENAI_API_KEY: 'fallback', [LEGACY_IMAGE_KEY_BINDING]: 'legacy' }), 'primary');
  assert.equal(resolveImageApiKey({ IMAGE_API_KEY: '', OPENAI_API_KEY: 'fallback', [LEGACY_IMAGE_KEY_BINDING]: 'legacy' }), 'fallback');
  assert.equal(resolveImageApiKey({ [LEGACY_IMAGE_KEY_BINDING]: 'legacy' }), 'legacy');
  assert.equal(resolveImageApiKey({ IMAGE_API_KEY_BINDING: 'MY_KNOWN_BINDING', MY_KNOWN_BINDING: 'custom' }), 'custom');
  assert.equal(resolveImageApiKey({ OTHER_UNRELATED_KEY: 'not-selected' }), undefined);
});

test('default status distinguishes key presence from verified connectivity; missing key and auth never call provider', async () => {
  const present = setup();
  try {
    const status = await (await present.GET(new Request('http://localhost/api/studio-image'))).json();
    assert.equal(status.verified, false); assert.equal(status.code, 'UNVERIFIED'); assert.equal(present.calls.length, 0);
  } finally { present.close(); }
  for (const options of [{ key: '' }, { user: null }]) {
    const context = setup(options);
    try {
      const status = await (await context.GET(new Request('http://localhost/api/studio-image?check=1'))).json();
      const post = await context.POST(generationRequest());
      assert.equal(status.available, false); assert.equal(context.calls.length, 0); assert.equal(post.status, options.key === '' ? 503 : 401);
    } finally { context.close(); }
  }
});

test('explicit diagnostic uses only the nonbillable fixed model endpoint', async () => {
  const context = setup({ provider: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/models/gpt-image-1.5');
    assert.equal(options.body, undefined);
    return Response.json({ id: 'gpt-image-1.5' });
  } });
  try { const status = await (await context.GET(new Request('http://localhost/api/studio-image?check=1'))).json(); assert.equal(status.code, 'READY'); assert.equal(status.verified, true); }
  finally { context.close(); }
});

test('diagnostics classify revoked key, model, quota, timeout and network without forwarding secret/provider text', async () => {
  const cases = [[401, undefined, 'INVALID_API_KEY'], [403, undefined, 'MODEL_ACCESS_DENIED'], [404, undefined, 'MODEL_NOT_FOUND'], [429, 'insufficient_quota', 'PROVIDER_QUOTA'], [429, undefined, 'PROVIDER_RATE_LIMIT'], [500, undefined, 'PROVIDER_UNAVAILABLE']];
  for (const [status, code, expected] of cases) {
    const context = setup({ provider: async () => Response.json({ error: { code, message: 'UPSTREAM_PRIVATE_DETAILS test-fixture-key' } }, { status }) });
    try {
      const data = await (await context.GET(new Request('http://localhost/api/studio-image?check=1'))).json();
      assert.equal(data.code, expected); assert.equal(data.available, false); assert.doesNotMatch(JSON.stringify(data), /UPSTREAM_PRIVATE_DETAILS|test-fixture-key/);
    } finally { context.close(); }
  }
  for (const [e, expected] of [[new DOMException('timeout', 'TimeoutError'), 'PROVIDER_TIMEOUT'], [new TypeError('sensitive network details'), 'NETWORK_ERROR']]) {
    const context = setup({ provider: async () => { throw e; } });
    try { assert.equal((await (await context.GET(new Request('http://localhost/api/studio-image?check=1'))).json()).code, expected); }
    finally { context.close(); }
  }
});

test('generation validates origin and file before provider traffic', async () => {
  const context = setup();
  try {
    assert.equal((await context.POST(generationRequest(undefined, { origin: 'https://foreign.example' }))).status, 403);
    assert.equal((await context.POST(generationRequest(undefined, { image: 'not-png' }))).status, 400);
    assert.equal(context.calls.length, 0);
  } finally { context.close(); }
});

test('successful generation stores bytes, preserves reference/product order and replays without a second charge', async () => {
  const context = setup({ provider: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    const inputs = options.body.getAll('image[]');
    assert.equal(inputs[0].name, 'reference.png'); assert.equal(inputs[1].name, 'product.png');
    assert.equal(options.body.get('input_fidelity'), 'high');
    return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  } });
  try {
    const first = await (await context.POST(generationRequest(undefined, { reference: true }))).json();
    assert.ok(first.asset); assert.deepEqual(Buffer.from(context.files.get(first.asset.id)), png);
    const second = await (await context.POST(generationRequest(undefined, { reference: true }))).json();
    assert.equal(second.asset.id, first.asset.id); assert.equal(context.calls.length, 1);
    const conflict = await context.POST(generationRequest(undefined, { prompt: 'Different scene' }));
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, 'IDEMPOTENCY_CONFLICT');
  } finally { context.close(); }
});

test('timeouts, network failures, provider 5xx and malformed successful responses remain indeterminate with no repeat charge', async () => {
  const cases = [
    [async () => { throw new DOMException('timeout', 'TimeoutError'); }, 'PROVIDER_TIMEOUT'],
    [async () => { throw new TypeError('connection lost'); }, 'NETWORK_ERROR'],
    [async () => Response.json({}, { status: 500 }), 'PROVIDER_UNAVAILABLE'],
    [async () => new Response('malformed', { status: 200 }), 'INVALID_PROVIDER_RESPONSE'],
  ];
  for (const [provider, code] of cases) {
    const context = setup({ provider });
    try {
      const result = await (await context.POST(generationRequest())).json();
      assert.equal(result.code, code); assert.equal(result.jobState, 'indeterminate'); assert.equal(result.retryable, false);
      const retry = await (await context.POST(generationRequest())).json();
      assert.equal(retry.code, 'GENERATION_INDETERMINATE'); assert.equal(context.calls.length, 1);
    } finally { context.close(); }
  }
});

test('provider credential rejection is definitive and reported distinctly', async () => {
  const context = setup({ provider: async () => Response.json({ error: { message: 'provider secret text' } }, { status: 401 }) });
  try {
    const data = await (await context.POST(generationRequest())).json();
    assert.equal(data.code, 'INVALID_API_KEY'); assert.equal(data.jobState, 'failed'); assert.equal(data.retryable, true);
    assert.doesNotMatch(JSON.stringify(data), /provider secret text/);
  } finally { context.close(); }
});

test('R2 failure preserves uncertain state; confirmed write recovers even if response or D1 completion was lost', async () => {
  const failed = setup({ failPut: true });
  try {
    const data = await (await failed.POST(generationRequest())).json();
    assert.equal(data.code, 'GENERATION_STORAGE_FAILED'); assert.equal(data.jobState, 'indeterminate');
    await failed.POST(generationRequest()); assert.equal(failed.calls.length, 1);
  } finally { failed.close(); }
  for (const options of [{ writeThenFail: true }, { failDone: true }]) {
    const context = setup(options);
    try {
      await context.POST(generationRequest());
      const recovered = await (await context.POST(generationRequest())).json();
      assert.ok(recovered.asset); assert.equal(context.calls.length, 1); assert.deepEqual(Buffer.from(context.files.get(recovered.asset.id)), png);
    } finally { context.close(); }
  }
});

test('local quota blocks a second unique request without provider traffic', async () => {
  const context = setup();
  try {
    await context.POST(generationRequest());
    const result = await (await context.POST(generationRequest('f22c1025-7722-4e13-ab9e-78299f211ee5'))).json();
    assert.equal(result.code, 'LOCAL_RATE_LIMIT'); assert.equal(context.calls.length, 1);
  } finally { context.close(); }
});
