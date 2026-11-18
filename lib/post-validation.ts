import type { Asset, Post } from './types';

const statuses = new Set(['En attente', 'Validé', 'À retravailler', 'Publié']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export class InvalidPost extends Error {}
function invalid(message: string): never { throw new InvalidPost(message); }
function optionalText(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) invalid(`${label} invalide (maximum ${max} caractères).`);
  return value;
}
export function validPostDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
export function validPostId(value: unknown): value is string {
  // Existing calendars include template-example and older 32-character fallback IDs.
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}
function asset(value: unknown, thumbnail = false): Asset {
  if (!object(value)) invalid('Fichier invalide.');
  const { id, url, name, type, size } = value;
  if (typeof id !== 'string' || typeof url !== 'string' || typeof name !== 'string' || !name || name.length > 255 || typeof type !== 'string' || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(type) || type.length > 255 || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > 25 * 1024 * 1024) invalid('Les informations du fichier sont invalides.');
  if (url !== '/template-post.jpg' && (!uuid.test(id) || url !== `/api/files?id=${id}` || size === 0)) invalid('Le fichier doit provenir du stockage de l’application.');
  if (thumbnail && !/^image\/(png|jpeg|webp|gif)$/.test(type)) invalid('Choisissez une miniature PNG, JPEG, WebP ou GIF.');
  return { id, url, name, type, size };
}
export function parsePost(value: unknown): Post {
  if (!object(value)) invalid('La publication doit être un objet JSON.');
  if (!validPostId(value.id)) invalid('Identifiant de publication invalide.');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 150) invalid('Indiquez un titre de 150 caractères maximum.');
  if (!validPostDate(value.date)) invalid('Choisissez une date de calendrier valide.');
  if (typeof value.status !== 'string' || !statuses.has(value.status)) invalid('Statut de publication invalide.');
  const project = optionalText(value.project, 80, 'Projet').trim() || 'FASTWAY';
  const caption = optionalText(value.caption, 20000, 'Légende');
  const comment = optionalText(value.comment, 20000, 'Commentaire');
  const drive = optionalText(value.drive, 2048, 'Lien Google Drive');
  if (drive) {
    let url: URL;
    try { url = new URL(drive); } catch { invalid('Le lien Google Drive est invalide.'); }
    if (url.protocol !== 'https:' || !['drive.google.com', 'docs.google.com'].includes(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) invalid('Utilisez un lien HTTPS Google Drive ou Google Docs.');
  }
  if (!Array.isArray(value.assets) || value.assets.length > 30) invalid('Maximum 30 fichiers par publication.');
  const assets = value.assets.map(item => asset(item));
  const thumbnail = value.thumbnail == null ? null : asset(value.thumbnail, true);
  return { id: value.id, title: value.title.trim(), date: value.date, status: value.status, project, caption, comment, drive, assets, thumbnail, updated: '' };
}
