import {storage,safeMutation,failure} from '@/lib/storage';
import {InvalidPost,parsePost,validPostId} from '@/lib/post-validation';
export async function GET(){try{const {DB}=storage();await DB.batch([
DB.prepare("INSERT OR IGNORE INTO posts (id,title,date,project,status,caption,comment,drive,assets,updated) SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key='initialized')").bind('template-example','Machine expresso','2026-09-01','FASTWAY','En attente','Exemple repris de votre template. Remplacez ce visuel par le fichier original en haute définition.','','',JSON.stringify([{id:'template',name:'Machine-expresso-exemple.jpg',url:'/template-post.jpg',type:'image/jpeg',size:0}]),new Date().toISOString()),
DB.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('initialized','1')")]);
const {results}=await DB.prepare('SELECT * FROM posts ORDER BY date,title').all();return Response.json(results.map(p=>({...p,assets:JSON.parse(p.assets as string),thumbnail:p.thumbnail?JSON.parse(p.thumbnail as string):null})),{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e)}}
export async function POST(req:Request){
try{safeMutation(req);}catch{return Response.json({error:'Origine non autorisée.'},{status:403});}
let p;
try{p=parsePost(await req.json());}catch(e){return Response.json({error:e instanceof InvalidPost?e.message:'Le corps de la requête doit être un JSON valide.'},{status:400});}
try{
const {DB}=storage();const updated=new Date().toISOString();await DB.prepare('INSERT INTO posts (id,title,date,project,status,caption,comment,drive,assets,updated,thumbnail) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,date=excluded.date,project=excluded.project,status=excluded.status,caption=excluded.caption,comment=excluded.comment,drive=excluded.drive,assets=excluded.assets,updated=excluded.updated,thumbnail=excluded.thumbnail').bind(p.id,p.title,p.date,p.project,p.status,p.caption,p.comment,p.drive,JSON.stringify(p.assets),updated,p.thumbnail?JSON.stringify(p.thumbnail):null).run();return Response.json({...p,updated});
}catch(e){return failure(e);}}
export async function DELETE(req:Request){
try{safeMutation(req);}catch{return Response.json({error:'Origine non autorisée.'},{status:403});}
let id;
try{const body:unknown=await req.json();id=body && typeof body==='object' && !Array.isArray(body)?(body as {id?:unknown}).id:undefined;if(!validPostId(id))return Response.json({error:'Identifiant manquant ou invalide.'},{status:400});}
catch{return Response.json({error:'Le corps de la requête doit être un JSON valide.'},{status:400});}
try{await storage().DB.prepare('DELETE FROM posts WHERE id=?').bind(id).run();return Response.json({ok:true});}catch(e){return failure(e);}}
