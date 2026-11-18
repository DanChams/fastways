import { DEFAULT_STUDIO_DOCUMENT, type StudioDocument } from './studio-renderer';

export type StudioDraft = {
  version: 1;
  document: StudioDocument;
  source: string;
  sourceName: string;
  reference: string;
  referenceName: string;
  prompt: string;
  date: string;
  project: string;
};
const DB_NAME = 'fastway-studio';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Le brouillon ne peut pas être conservé dans ce navigateur.'));
  });
}
export async function readDraft(): Promise<StudioDraft | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get('current');
      request.onsuccess = () => { try { resolve(request.result ? parseDraft(request.result) : null); } catch (e) { reject(e); } };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function writeDraft(draft: StudioDraft): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite');
      transaction.objectStore('drafts').put(draft, 'current');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Stockage local plein ou indisponible. Téléchargez votre brouillon.'));
      transaction.onabort = () => reject(new Error('Sauvegarde du brouillon interrompue.'));
    });
  } finally { db.close(); }
}
function validImage(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 15_000_000 && (value === '' || /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value) || /^\/api\/files\?id=[a-z0-9-]{36}$/.test(value) || value === '/studio-demo.png');
}
const textLimits: Partial<Record<keyof StudioDocument, number>> = {
  title: 150, features: 600, headline: 100, subheadline: 100,
  phone: 100, deliveryTitle: 100, deliveryRoute: 100, cta: 100,
};
function validDate(value: unknown): value is string {
  // A draft can be incomplete; publication validates that a date is present.
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(value);
  // Date.parse normalises e.g. 31 February instead of rejecting it.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function parseDraft(value: unknown): StudioDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ce fichier n’est pas un brouillon FASTWAY.');
  const data = value as Record<string, unknown>;
  const raw = data.document;
  if (data.version !== 1 || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Format de brouillon non reconnu.');
  const document = { ...DEFAULT_STUDIO_DOCUMENT };
  for (const key of Object.keys(document) as (keyof StudioDocument)[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (['photo', 'thumbnail', 'templateOverlay'].includes(key)) {
      if (!validImage(v)) throw new Error('Image invalide dans le brouillon.');
    } else if (typeof document[key] === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 2000) throw new Error('Position de texte invalide.');
    } else if (typeof v !== 'string' || v.length > (textLimits[key] ?? 2000)) throw new Error('Texte invalide dans le brouillon.');
    Object.assign(document, { [key]: v });
  }
  if (!['auto', 'custom', 'none'].includes(document.thumbnailMode)) throw new Error('Mode miniature invalide.');
  if (!validImage(data.source) || typeof data.sourceName !== 'string' || data.sourceName.length > 300 || typeof data.prompt !== 'string' || data.prompt.length > 2000 || typeof data.project !== 'string' || data.project.length > 80 || !validDate(data.date)) throw new Error('Informations du brouillon invalides.');
  document.photoScale = Math.max(.5, Math.min(2, document.photoScale));
  document.photoX = Math.max(-400, Math.min(400, document.photoX));
  document.photoY = Math.max(-400, Math.min(400, document.photoY));
  document.shade = Math.max(0, Math.min(1, document.shade));
  document.titleSize = Math.max(24, Math.min(90, document.titleSize));
  document.featuresSize = Math.max(18, Math.min(44, document.featuresSize));
  document.titleX = Math.max(20, Math.min(650, document.titleX));
  document.titleY = Math.max(180, Math.min(560, document.titleY));
  document.featuresX = Math.max(20, Math.min(650, document.featuresX));
  document.featuresY = Math.max(260, Math.min(620, document.featuresY));
  if (data.reference !== undefined && !validImage(data.reference)) throw new Error('Référence d’ambiance invalide.');
  if (data.referenceName !== undefined && (typeof data.referenceName !== 'string' || data.referenceName.length > 300)) throw new Error('Nom de référence invalide.');
  return { version: 1, document, reference: (data.reference as string) || '', referenceName: (data.referenceName as string) || '', source: data.source, sourceName: data.sourceName, prompt: data.prompt, date: data.date, project: data.project };
}
