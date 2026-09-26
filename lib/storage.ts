import { env } from 'cloudflare:workers';
export function storage() { const e = env as unknown as {DB:D1Database;BUCKET:R2Bucket}; if(!e.DB || !e.BUCKET) throw new Error('Stockage indisponible'); return e; }
export function safeMutation(req:Request) { const origin=req.headers.get('origin'); if(origin && origin!==new URL(req.url).origin) throw new Error('Origine non autorisée'); }
export function failure(e:unknown){ console.error(e); return Response.json({error:'Enregistrement impossible. Réessayez : vos informations sont conservées.'},{status:500}); }
