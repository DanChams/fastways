import type { Asset } from './types';

export type AIStatus = { configured: boolean; available: boolean; verified?: boolean; code?: string; reason?: string };
export class StudioRequestError extends Error {
  code: string;
  jobState?: string;
  retryable?: boolean;
  constructor(message: string, code = 'REQUEST_FAILED', state?: string, retryable?: boolean) {
    super(message); this.name = 'StudioRequestError'; this.code = code; this.jobState = state; this.retryable = retryable;
  }
}
export async function studioResponse<T>(response: Response): Promise<T> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    const auth = response.redirected || [401, 403].includes(response.status);
    throw new StudioRequestError(auth ? 'Votre session a expiré ou cet accès est protégé. Reconnectez-vous au site.' : 'Le serveur a renvoyé une réponse illisible. Réessayez sans quitter votre brouillon.', auth ? 'AUTH_REQUIRED' : 'INVALID_RESPONSE');
  }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new StudioRequestError('La réponse du serveur a été interrompue. Réessayez pour vérifier la même opération.', 'INVALID_RESPONSE'); }
  if (!data || typeof data !== 'object') throw new StudioRequestError('Réponse du serveur invalide.', 'INVALID_RESPONSE');
  if (!response.ok) {
    const error = data as { error?: unknown; code?: unknown; jobState?: unknown; retryable?: unknown };
    throw new StudioRequestError(typeof error.error === 'string' ? error.error : 'La requête n’a pas abouti.', typeof error.code === 'string' ? error.code : `HTTP_${response.status}`, typeof error.jobState === 'string' ? error.jobState : undefined, typeof error.retryable === 'boolean' ? error.retryable : undefined);
  }
  return data as T;
}
export async function checkAIConnection(verify = false): Promise<AIStatus> {
  const response = await fetch('/api/studio-image' + (verify ? '?check=1' : ''), { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  const status = await studioResponse<AIStatus>(response);
  if (typeof status.configured !== 'boolean' || typeof status.available !== 'boolean') throw new StudioRequestError('Statut du service IA invalide.', 'INVALID_RESPONSE');
  return status;
}
export function validAsset(value: unknown): value is Asset {
  if (!value || typeof value !== 'object') return false;
  const asset = value as Asset;
  return typeof asset.id === 'string' && /^[a-z0-9-]{36}$/.test(asset.id) && asset.url === `/api/files?id=${asset.id}` && ['image/png', 'image/jpeg', 'image/webp'].includes(asset.type) && typeof asset.name === 'string' && typeof asset.size === 'number' && Number.isFinite(asset.size) && asset.size > 0;
}
export async function fingerprint(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

export type GenerationJournal = { fingerprint: string; key: string; retry: boolean };
export type SaveJournal = { fingerprint: string; id: string; asset?: Asset; thumbnail?: Asset; saved?: boolean };
const generationKey = 'fastway-generation-operation';
const saveKey = 'fastway-save-operation';
function readJournal(key: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    return value && typeof value === 'object' && /^[a-f0-9]{64}$/.test(value.fingerprint) ? value : null;
  } catch { return null; }
}
export function readGeneration(): GenerationJournal | null {
  const value = readJournal(generationKey);
  return value && typeof value.key === 'string' && /^[a-f0-9-]{36}$/i.test(value.key) && typeof value.retry === 'boolean' ? value as GenerationJournal : null;
}
export function readSave(): SaveJournal | null {
  const value = readJournal(saveKey);
  return value && typeof value.id === 'string' && /^[a-f0-9-]{36}$/i.test(value.id) && (!value.asset || validAsset(value.asset)) && (!value.thumbnail || validAsset(value.thumbnail)) ? value as SaveJournal : null;
}
export function keepGeneration(value: GenerationJournal) { try { sessionStorage.setItem(generationKey, JSON.stringify(value)); } catch { /* In-memory idempotency still protects the current page. */ } }
export function keepSave(value: SaveJournal) { try { sessionStorage.setItem(saveKey, JSON.stringify(value)); } catch { /* In-memory idempotency still protects the current page. */ } }
