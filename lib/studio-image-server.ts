// Shared pure validation helpers. Credentials and provider traffic stay in the route.
export const IMAGE_LIMIT = 10 * 1024 * 1024;
export const IMAGE_REQUEST_LIMIT = 22 * 1024 * 1024;
// This is a known saved binding NAME, never a credential value. Keep compatibility
// with the existing environment requirement while allowing a deliberate override.
export const LEGACY_IMAGE_KEY_BINDING = 'key_W3fbkU7fygzboP56';
export function resolveImageApiKey(bindings: Record<string, unknown>): string | undefined {
  const alias = typeof bindings.IMAGE_API_KEY_BINDING === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(bindings.IMAGE_API_KEY_BINDING)
    ? bindings.IMAGE_API_KEY_BINDING : LEGACY_IMAGE_KEY_BINDING;
  for (const name of ['IMAGE_API_KEY', 'OPENAI_API_KEY', alias]) {
    const value = bindings[name];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}
export const IMAGE_PROMPT = `Create a photorealistic product photograph using the supplied product as a strict reference. Preserve its exact shape, proportions, colors, materials, logo, labels, components, clothing cut and details. Change only its environment, lighting and natural shadows. Never invent product features. Do not add text, prices, icons, graphics, watermarks, logos or people. Leave clear space on the left for advertising text that will be added separately. Keep the entire product visible on the right. Scene requested by the user:\n`;

export function generationPrompt(scene: string, withReference: boolean) {
  if (!withReference) return IMAGE_PROMPT + scene.trim();
  return `Visual transposition with STRICT IMAGE ROLES: IMAGE 1 is ONLY the art-direction reference. IMAGE 2 is the STRICT PRODUCT reference and is the only product to depict. Never reverse these roles. Preserve IMAGE 2 product exactly: silhouette, proportions, shape, geometry, relative dimensions, colors, materials, finish, texture, logos, typography, inscriptions, components, garment cut and every distinctive detail. Never redesign, recolor, reshape or stylize this product to resemble any object in IMAGE 1. Transfer ONLY IMAGE 1's scene principles: composition, camera framing, perspective, lighting direction and softness, shadows, environment reflections, palette, background, surfaces, depth of field, negative space and atmosphere. Adapt the scene to IMAGE 2's product, never the product to the scene. Remove the objects from IMAGE 1; do not transplant their shapes or branding. Natural incident light and shadows may change, intrinsic product characteristics may not. If art direction conflicts with product integrity, product integrity wins. Generate only the product photograph, no advertising text, price, additional icons, pictograms, graphic decorations or watermarks. Keep the entire product visible on the right and leave clear space on the left for text added separately. User scene instructions:\n${scene.trim()}`;
}

export function appendGenerationImages(form: FormData, product: File, reference: File | null) {
  if (reference) {
    // OpenAI Images Edits accepts multiple uploads as image[] in their explicit order.
    form.append('image[]', reference);
    form.append('image[]', product);
  } else form.set('image', product);
}

export function validImageSignature(bytes: Uint8Array, mime: string) {
  if (mime === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/webp') return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return false;
}

export function validIdempotencyKey(key: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
}

export function localRequest(url: string) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
}

export async function boundedBody(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new RangeError('Body limit exceeded'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

type ImageAsset = { id: string; name: string; url: string; type: string; size: number };
type ImageSettings = { key?: string; model: string };
type JobState = 'pending' | 'done' | 'failed' | 'indeterminate';
type ProviderFailure = { code: string; message: string; status: number };
type ImageJob = { hash: string; state: JobState; fileId?: string; asset?: ImageAsset; failure?: ProviderFailure };
export type StudioImageDependencies = {
  settings: () => ImageSettings;
  identity: (req: Request) => Promise<string | null>;
  storage: () => { DB: D1Database; BUCKET: R2Bucket };
  fetch: typeof fetch;
  now?: () => Date;
};

const noCache = { 'Cache-Control': 'no-store' };
const json = (data: object, status = 200) => Response.json(data, { status, headers: noCache });
const failureResponse = (failure: ProviderFailure, extra: object = {}) => json({ error: failure.message, code: failure.code, retryable: true, ...extra }, failure.status);
const issue = (code: string, message: string, status: number): ProviderFailure => ({ code, message, status });

async function sha256(value: ArrayBuffer | Uint8Array | string) {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const bytes = await crypto.subtle.digest('SHA-256', input as BufferSource);
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}

async function providerFailure(response: Response): Promise<ProviderFailure> {
  // Only classify allowlisted machine codes. Never forward provider messages or bodies.
  let code: unknown;
  try { code = (JSON.parse(new TextDecoder().decode(await boundedBody(response.body, 32 * 1024))) as { error?: { code?: string } }).error?.code; } catch { /* HTTP status is sufficient fallback. */ }
  if (response.status === 401 || code === 'invalid_api_key') return issue('INVALID_API_KEY', 'La clé API a été supprimée, révoquée ou refusée. Remplacez-la dans les paramètres sécurisés du serveur.', 503);
  if (response.status === 403) return issue('MODEL_ACCESS_DENIED', 'Le compte ou la clé serveur n’a pas accès au modèle image configuré.', 503);
  if (response.status === 404 || ['model_not_found', 'model_not_supported', 'unsupported_model'].includes(String(code))) return issue('MODEL_NOT_FOUND', 'Le modèle image configuré est introuvable ou inaccessible. Vérifiez IMAGE_MODEL et les autorisations du compte.', 503);
  if (['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active'].includes(String(code))) return issue('PROVIDER_QUOTA', 'Le compte du service IA n’a plus de crédit ou a atteint son plafond de facturation.', 429);
  if (response.status === 429) return issue('PROVIDER_RATE_LIMIT', 'Le service IA limite temporairement les demandes. Attendez avant de réessayer.', 429);
  if (response.status >= 500) return issue('PROVIDER_UNAVAILABLE', 'Le service IA est temporairement indisponible.', 502);
  return issue('PROVIDER_REJECTED', 'Le service IA a refusé la photo ou les instructions. Vérifiez les données et le modèle configuré.', 422);
}

function transportFailure(e: unknown): ProviderFailure {
  const name = e && typeof e === 'object' && 'name' in e ? e.name : '';
  return name === 'TimeoutError' || name === 'AbortError'
    ? issue('PROVIDER_TIMEOUT', 'Le délai de réponse du service IA a été dépassé.', 504)
    : issue('NETWORK_ERROR', 'La connexion serveur au service IA a échoué. Vérifiez l’accès réseau.', 502);
}

export function createStudioImageService(deps: StudioImageDependencies) {
  async function GET(req: Request) {
    const config = deps.settings();
    if (!config.key) return json({ configured: false, available: false, verified: false, code: 'NOT_CONFIGURED', reason: 'Aucune clé du service IA n’est disponible dans ce serveur. Configurez ou synchronisez la liaison sécurisée de l’environnement.' });
    let user: string | null;
    try { user = await deps.identity(req); } catch { user = null; }
    if (!user) return json({ configured: true, available: false, verified: false, code: 'AUTH_REQUIRED', reason: 'Connectez-vous au site pour utiliser la génération IA.' });
    if (new URL(req.url).searchParams.get('check') !== '1') return json({ configured: true, available: true, verified: false, code: 'UNVERIFIED', reason: 'Clé présente. La connexion au service IA reste à vérifier.' });
    try {
      // This models endpoint never requests or bills an image generation.
      const response = await deps.fetch(`https://api.openai.com/v1/models/${encodeURIComponent(config.model)}`, {
        headers: { Authorization: `Bearer ${config.key}` }, signal: AbortSignal.timeout(10000), redirect: 'error',
      });
      if (!response.ok) {
        const failure = await providerFailure(response);
        return json({ configured: true, available: false, verified: true, code: failure.code, reason: failure.message });
      }
      await response.body?.cancel();
      return json({ configured: true, available: true, verified: true, code: 'READY', reason: 'Connexion et accès au modèle vérifiés. Le crédit et la génération seront contrôlés lors de la demande.' });
    } catch (e) {
      const failure = transportFailure(e);
      return json({ configured: true, available: false, verified: false, code: failure.code, reason: failure.message });
    }
  }

  async function POST(req: Request) {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin) return failureResponse(issue('INVALID_ORIGIN', 'Origine non autorisée.', 403));
    const config = deps.settings();
    if (!config.key) return failureResponse(issue('NOT_CONFIGURED', 'Aucune clé du service IA n’est disponible dans ce serveur. Configurez ou synchronisez la liaison sécurisée de l’environnement.', 503));
    let user: string | null;
    try { user = await deps.identity(req); } catch { user = null; }
    if (!user) return failureResponse(issue('AUTH_REQUIRED', 'Connectez-vous au site pour utiliser la génération IA.', 401));
    const invalid = (message: string, status = 400) => failureResponse(issue(status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT', message, status));
    if (!req.headers.get('content-type')?.startsWith('multipart/form-data')) return invalid('Photo et description requises.');
    if (Number(req.headers.get('content-length') || 0) > IMAGE_REQUEST_LIMIT) return invalid('Les images doivent faire 10 Mo maximum chacune (22 Mo par requête).', 413);
    const requestId = req.headers.get('Idempotency-Key') || crypto.randomUUID();
    if (!validIdempotencyKey(requestId)) return invalid('Identifiant de génération invalide.');
    let form: FormData;
    try {
      const body = await boundedBody(req.body, IMAGE_REQUEST_LIMIT);
      form = await new Response(body as BodyInit, { headers: { 'content-type': req.headers.get('content-type')! } }).formData();
    } catch (e) { return invalid(e instanceof RangeError ? 'Les images doivent faire 10 Mo maximum chacune (22 Mo par requête).' : 'Impossible de lire les images.', e instanceof RangeError ? 413 : 400); }
    const image = form.get('image');
    const reference = form.get('reference');
    const prompt = form.get('prompt');
    if (!(image instanceof File) || !image.size || image.size > IMAGE_LIMIT) return invalid('Choisissez une photo PNG, JPEG ou WebP de 10 Mo maximum.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) return invalid('Décrivez le décor en 2 000 caractères maximum.');
    const imageBytes = await image.arrayBuffer();
    if (!validImageSignature(new Uint8Array(imageBytes), image.type)) return invalid('Cette photo doit être un véritable fichier PNG, JPEG ou WebP.');
    let referenceBytes: ArrayBuffer | null = null;
    if (reference !== null) {
      if (!(reference instanceof File) || !reference.size || reference.size > IMAGE_LIMIT) return invalid('La référence de décor doit être une image PNG, JPEG ou WebP de 10 Mo maximum.');
      referenceBytes = await reference.arrayBuffer();
      if (!validImageSignature(new Uint8Array(referenceBytes), reference.type)) return invalid('La référence de décor doit être un véritable fichier PNG, JPEG ou WebP.');
    }
    let DB: D1Database, BUCKET: R2Bucket;
    try { ({ DB, BUCKET } = deps.storage()); } catch { return failureResponse(issue('STORAGE_UNAVAILABLE', 'Le stockage du studio est indisponible.', 503)); }
    const userHash = await sha256(user);
    const hash = await sha256(`${await sha256(imageBytes)}:${referenceBytes ? await sha256(referenceBytes) : 'no-reference'}:${prompt.trim()}:${config.model}`);
    const jobKey = `studio-ai:job:${userHash}:${requestId}`;
    const fileHash = await sha256(`${userHash}:${requestId}`);
    const fileId = `${fileHash.slice(0, 8)}-${fileHash.slice(8, 12)}-${fileHash.slice(12, 16)}-${fileHash.slice(16, 20)}-${fileHash.slice(20, 32)}`;
    async function writeJob(job: ImageJob) { await DB.prepare('UPDATE settings SET value=? WHERE key=?').bind(JSON.stringify(job), jobKey).run(); }
    async function finish(failure: ProviderFailure, state: 'failed' | 'indeterminate') {
      try { await writeJob({ state, hash, fileId, failure }); } catch { /* An existing pending claim still prevents duplicate billing. */ }
      return failureResponse(failure, { jobState: state, retryable: state === 'failed' });
    }
    function assetFor(id: string, size: number): ImageAsset { return { id, name: 'fastway-produit-ia.png', type: 'image/png', size, url: `/api/files?id=${id}` }; }
    try {
      const claim = await DB.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').bind(jobKey, JSON.stringify({ state: 'pending', hash, fileId } satisfies ImageJob)).run();
      if (!claim.meta.changes) {
        const record = await DB.prepare('SELECT value FROM settings WHERE key=?').bind(jobKey).first<{ value: string }>();
        if (!record) return failureResponse(issue('TRACKING_UNAVAILABLE', 'Impossible de retrouver cette génération.', 503), { retryable: false });
        const previous: ImageJob = JSON.parse(record.value);
        if (previous.hash !== hash) return failureResponse(issue('IDEMPOTENCY_CONFLICT', 'Cet identifiant appartient à une autre génération.', 409), { retryable: false });
        if (previous.state === 'done' && previous.asset) return json({ asset: previous.asset });
        if (previous.fileId && previous.state !== 'failed') {
          const stored = await BUCKET.head(previous.fileId);
          if (stored) {
            const asset = assetFor(previous.fileId, stored.size);
            try { await writeJob({ state: 'done', hash, fileId: previous.fileId, asset }); } catch { /* File remains recoverable via deterministic storage key. */ }
            return json({ asset });
          }
        }
        if (previous.state === 'failed') return failureResponse(previous.failure || issue('GENERATION_FAILED', 'La précédente tentative a échoué. Relancez une nouvelle génération.', 409), { jobState: 'failed' });
        return failureResponse(issue(previous.state === 'indeterminate' ? 'GENERATION_INDETERMINATE' : 'GENERATION_PENDING', previous.state === 'indeterminate' ? 'La réponse précédente est incertaine et a pu être facturée. Vérifiez à nouveau cette même demande ; aucune nouvelle génération automatique ne sera envoyée.' : 'Cette génération est déjà en cours. Attendez sa réponse avant de réessayer.', 409), { jobState: previous.state, retryable: false });
      }
    } catch { return failureResponse(issue('TRACKING_UNAVAILABLE', 'Le suivi des générations est indisponible. Aucune nouvelle requête IA envoyée.', 503), { retryable: false }); }

    let providerStarted = false;
    try {
      const now = (deps.now?.() || new Date()).toISOString();
      const counters: [string, number][] = [
        [`studio-ai:minute:${userHash}:${now.slice(0, 16)}`, 1],
        [`studio-ai:quota:${userHash}:${now.slice(0, 10)}`, 5],
        [`studio-ai:quota:global:${now.slice(0, 10)}`, 30],
      ];
      for (const [key, maximum] of counters) {
        const result = await DB.prepare('INSERT INTO settings (key,value) VALUES (?,\'1\') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1 WHERE CAST(value AS INTEGER) < ? RETURNING value').bind(key, maximum).first();
        if (!result) return await finish(issue('LOCAL_RATE_LIMIT', 'Limite du site atteinte : une tentative par minute, cinq par jour et par utilisateur (30 par jour pour le site).', 429), 'failed');
      }
      const request = new FormData();
      request.set('model', config.model);
      const extension = (type: string) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type] || 'png');
      const productFile = new File([imageBytes], `product.${extension(image.type)}`, { type: image.type });
      const referenceFile = referenceBytes && reference instanceof File ? new File([referenceBytes], `reference.${extension(reference.type)}`, { type: reference.type }) : null;
      appendGenerationImages(request, productFile, referenceFile);
      request.set('prompt', generationPrompt(prompt, Boolean(referenceFile)));
      if (config.model === 'gpt-image-1.5') request.set('input_fidelity', 'high');
      request.set('size', '1024x1536'); request.set('quality', 'medium'); request.set('output_format', 'png'); request.set('n', '1');
      providerStarted = true;
      const response = await deps.fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST', headers: { Authorization: `Bearer ${config.key}` }, body: request,
        signal: AbortSignal.timeout(180000), redirect: 'error',
      });
      if (!response.ok) {
        const failure = await providerFailure(response);
        // 5xx may occur after provider processing; do not silently re-bill the request.
        return await finish(failure, response.status >= 500 ? 'indeterminate' : 'failed');
      }
      let result: { data?: { b64_json?: string }[] };
      try { result = JSON.parse(new TextDecoder().decode(await boundedBody(response.body, 30 * 1024 * 1024))); }
      catch (e) {
        const timeout = e && typeof e === 'object' && 'name' in e && ['TimeoutError', 'AbortError'].includes(String(e.name));
        return await finish(timeout ? transportFailure(e) : issue('INVALID_PROVIDER_RESPONSE', 'La réponse du service IA est illisible ou trop volumineuse. Une facturation reste possible.', 502), 'indeterminate');
      }
      const base64 = result.data?.[0]?.b64_json;
      if (typeof base64 !== 'string' || !base64 || base64.length > 28 * 1024 * 1024) return await finish(issue('INVALID_PROVIDER_RESPONSE', 'Le service IA n’a pas renvoyé d’image exploitable. Une facturation reste possible.', 502), 'indeterminate');
      let binary: string;
      try { binary = atob(base64); } catch { return await finish(issue('INVALID_PROVIDER_RESPONSE', 'L’image renvoyée par le service IA est illisible. Une facturation reste possible.', 502), 'indeterminate'); }
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      if (!validImageSignature(bytes, 'image/png')) return await finish(issue('INVALID_PROVIDER_RESPONSE', 'L’image reçue du service IA est invalide. Une facturation reste possible.', 502), 'indeterminate');
      try { await BUCKET.put(fileId, bytes, { httpMetadata: { contentType: 'image/png' }, customMetadata: { name: 'fastway-produit-ia.png' } }); }
      catch { return await finish(issue('GENERATION_STORAGE_FAILED', 'L’image a été générée, mais son enregistrement reste incertain. Vérifiez cette même demande avant de relancer une génération.', 503), 'indeterminate'); }
      const asset = assetFor(fileId, bytes.byteLength);
      try { await writeJob({ state: 'done', hash, fileId, asset }); } catch { /* R2 upload succeeded; same-key retries recover it via head(). */ }
      return json({ asset });
    } catch (e) {
      if (providerStarted) {
        const failure = transportFailure(e);
        return await finish({ ...failure, message: `${failure.message} La génération a pu être traitée et facturée ; vérifiez à nouveau cette même demande.` }, 'indeterminate');
      }
      return await finish(issue('TRACKING_UNAVAILABLE', 'La préparation de la génération a échoué. Aucune requête IA envoyée.', 503), 'failed');
    }
  }
  return { GET, POST };
}
