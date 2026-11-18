'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Download, ImagePlus, Layers3, Loader2, Maximize2, Move, RotateCcw, Save, Sparkles, Type, Upload, X } from 'lucide-react';
import { canvasBlob, DEFAULT_STUDIO_DOCUMENT, POSTER_HEIGHT, POSTER_WIDTH, readStudioImage, renderPoster, type StudioDocument } from '@/lib/studio-renderer';
import { parseDraft, readDraft, writeDraft, type StudioDraft } from '@/lib/studio-drafts';
import type { Asset, Post } from '@/lib/types';
import { checkAIConnection, fingerprint, keepGeneration, keepSave, readGeneration, readSave, StudioRequestError, studioResponse, validAsset, type AIStatus, type GenerationJournal, type SaveJournal } from '@/lib/studio-client';
import './studio.css';

type Tab = 'image' | 'thumbnail' | 'text';
const tabs = [{ id: 'image' as const, label: 'Image produit', icon: Sparkles }, { id: 'thumbnail' as const, label: 'Miniature', icon: Layers3 }, { id: 'text' as const, label: 'Textes', icon: Type }];
const defaultPrompt = 'Un intérieur contemporain lumineux, tons crème et bois clair, lumière naturelle latérale, ombres douces. Le produit entier dans la moitié droite, de l’espace libre à gauche pour mes textes.';
const exampleDocument: StudioDocument = { ...DEFAULT_STUDIO_DOCUMENT, title: 'Ventilateur\nde table', price: '60', features: 'Votre description ici\nVos caractéristiques produit', photo: '/studio-demo.png' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function downloadFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function dataFile(url: string, name: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Cette image n’est plus disponible. Réimportez-la.');
  const blob = await response.blob();
  return new File([blob], name || 'produit.png', { type: blob.type });
}
function Range({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="fw-range"><span>{label}<output>{Math.round(value * (step < 1 ? 100 : 1))}{suffix}</output></span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}/></label>;
}
function PictureInput({ label, value, caption, disabled, onChange, onClear }: { label: string; value: string; caption: string; disabled?: boolean; onChange: (file: File) => void; onClear?: () => void }) {
  return <div className="fw-picture-input"><label className={value ? 'fw-dropzone has-image' : 'fw-dropzone'}>{value ? <img src={value} alt={label}/> : <Upload size={22}/>}<span><strong>{label}</strong><small>{caption}</small></span><input type="file" aria-label={label} accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={e => { if (e.target.files?.[0]) onChange(e.target.files[0]); e.target.value = ''; }}/></label>{value && onClear && <button type="button" className="fw-clear" aria-label={`Retirer ${label}`} onClick={onClear} disabled={disabled}><X size={14}/></button>}</div>;
}
export default function Studio() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<StudioDocument>(DEFAULT_STUDIO_DOCUMENT);
  const [tab, setTab] = useState<Tab>('image');
  const [source, setSource] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [reference, setReference] = useState('');
  const [referenceName, setReferenceName] = useState('');
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [date, setDate] = useState(today);
  const [project, setProject] = useState('FASTWAY');
  const [hydrated, setHydrated] = useState(false);
  const [draftStatus, setDraftStatus] = useState('Chargement…');
  const [storageError, setStorageError] = useState('');
  const [renderError, setRenderError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rendered, setRendered] = useState(false);
  const [ai, setAI] = useState<AIStatus | null>(null);
  const [checkingAI, setCheckingAI] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState('');
  const [variants, setVariants] = useState<Asset[]>([]);
  const [selectedText, setSelectedText] = useState<'title' | 'features'>('title');
  const [full, setFull] = useState(false);
  const renderVersion = useRef(0);
  const generationLock = useRef(false);
  const saveLock = useRef(false);
  const job = useRef<GenerationJournal | null>(null);
  const pendingSave = useRef<SaveJournal | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = generating || saving;
  const isExample = !doc.photo;
  const currentFingerprint = JSON.stringify([doc, date, project]);
  const saved = savedFingerprint === currentFingerprint;
  const canExport = rendered && !!doc.photo && !!doc.title.trim() && !!doc.price.trim() && !renderError;

  function change<K extends keyof StudioDocument>(key: K, value: StudioDocument[K]) { setDoc(old => ({ ...old, [key]: value })); setError(''); setNotice(''); }
  function restore(draft: StudioDraft) {
    setDoc(draft.document); setSource(draft.source); setSourceName(draft.sourceName); setReference(draft.reference); setReferenceName(draft.referenceName); setPrompt(draft.prompt); setDate(draft.date); setProject(draft.project); setSavedFingerprint('');
  }
  useEffect(() => {
    let live = true;
    job.current = readGeneration(); pendingSave.current = readSave();
    readDraft().then(draft => { if (!live) return; if (draft) { restore(draft); setNotice('Votre dernier brouillon a été restauré.'); } setHydrated(true); setDraftStatus(draft ? 'Brouillon restauré' : 'Nouveau projet'); }).catch(() => { if (live) { setHydrated(true); setStorageError('Sauvegarde locale indisponible. Téléchargez votre brouillon avant de quitter.'); } });
    function refresh() {
      checkAIConnection().then(status => { if (live) setAI(status); }).catch(() => { if (live) setAI({ configured: false, available: false, reason: 'Connexion au service de génération indisponible.' }); });
    }
    refresh();
    window.addEventListener('focus', refresh);
    return () => { live = false; window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const timeout = setTimeout(() => {
      setDraftStatus('Sauvegarde…');
      writeDraft({ version: 1, document: doc, source, sourceName, reference, referenceName, prompt, date, project }).then(() => { setDraftStatus('Brouillon sauvegardé'); setStorageError(''); }).catch(e => { setDraftStatus('Brouillon non sauvegardé'); setStorageError(e.message); });
    }, 700);
    return () => clearTimeout(timeout);
  }, [doc, source, sourceName, reference, referenceName, prompt, date, project, hydrated]);
  useEffect(() => {
    const version = ++renderVersion.current;
    const output = document.createElement('canvas');
    const previewDoc = !doc.photo ? { ...exampleDocument, ...doc, photo: exampleDocument.photo, title: doc.title || exampleDocument.title, price: doc.price || exampleDocument.price, features: doc.features || exampleDocument.features } : doc;
    renderPoster(output, previewDoc).then(() => {
      if (version !== renderVersion.current || !canvas.current) return;
      canvas.current.width = POSTER_WIDTH; canvas.current.height = POSTER_HEIGHT;
      canvas.current.getContext('2d')?.drawImage(output, 0, 0);
      setRendered(true); setRenderError('');
    }).catch(e => { if (version === renderVersion.current) { setRenderError(e.message); setRendered(false); } });
  }, [doc]);

  async function importPicture(file: File, kind: 'source' | 'reference' | 'thumbnail' | 'overlay' | 'scene') {
    setError(''); setNotice('');
    try {
      if (kind === 'overlay' && file.type !== 'image/png') throw new Error('Importez un calque PNG transparent sans photo ni textes variables.');
      const url = await readStudioImage(file);
      if (kind === 'source') { setSource(url); setSourceName(file.name); setDoc(old => ({ ...old, photo: url, photoScale: 1, photoX: 0, photoY: 0 })); }
      if (kind === 'reference') { setReference(url); setReferenceName(file.name); }
      if (kind === 'scene') change('photo', url);
      if (kind === 'thumbnail') setDoc(old => ({ ...old, thumbnail: url, thumbnailMode: 'custom' }));
      if (kind === 'overlay') change('templateOverlay', url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Import impossible.'); }
  }
  async function verifyConnection() {
    if (checkingAI) return;
    setCheckingAI(true);
    try { setAI(await checkAIConnection(true)); }
    catch (e) { setAI({ configured: false, available: false, reason: e instanceof Error ? e.message : 'Connexion au service IA indisponible.' }); }
    finally { setCheckingAI(false); }
  }
  async function generate() {
    if (generationLock.current || !source || !prompt.trim()) return;
    generationLock.current = true; setGenerating(true); setError(''); setNotice('');
    try {
      const signature = await fingerprint([source, reference, prompt]);
      if (job.current?.fingerprint !== signature || !job.current.retry) job.current = { fingerprint: signature, key: crypto.randomUUID(), retry: true };
      keepGeneration(job.current);
      const form = new FormData(); form.set('image', await dataFile(source, sourceName)); form.set('prompt', prompt);
      if (reference) form.set('reference', await dataFile(reference, referenceName));
      const response = await fetch('/api/studio-image', { method: 'POST', headers: { 'Idempotency-Key': job.current.key }, body: form });
      const data = await studioResponse<{asset?: Asset}>(response);
      const asset = data.asset;
      if (!validAsset(asset)) throw new StudioRequestError('Le service n’a pas renvoyé d’image exploitable.', 'INVALID_RESPONSE');
      job.current.retry = false; keepGeneration(job.current);
      setVariants(old => [asset, ...old.filter(item => item.id !== asset.id)].slice(0, 4));
      setDoc(old => ({ ...old, photo: asset.url, photoScale: 1, photoX: 0, photoY: 0 }));
      setNotice('Image générée. Vérifiez les détails du produit avant de finaliser votre affiche.');
    } catch (e) {
      if (e instanceof StudioRequestError) {
        if (job.current && (e.jobState === 'failed')) { job.current.retry = false; keepGeneration(job.current); }
        if (['NOT_CONFIGURED', 'INVALID_API_KEY', 'AUTH_REQUIRED', 'MODEL_ACCESS_DENIED', 'MODEL_NOT_FOUND', 'PROVIDER_QUOTA'].includes(e.code)) setAI({ configured: e.code !== 'NOT_CONFIGURED', available: false, code: e.code, reason: e.message });
      }
      setError(e instanceof TypeError ? 'Connexion interrompue. Réessayez pour vérifier la même génération.' : e instanceof Error ? e.message : 'Connexion interrompue. Réessayez pour vérifier la même génération.');
    }
    finally { generationLock.current = false; setGenerating(false); }
  }
  async function exportPNG() {
    setError('');
    try { const output = document.createElement('canvas'); await renderPoster(output, doc); downloadFile(await canvasBlob(output), 'fastway-affiche.png'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Export impossible.'); }
  }
  function exportDraft() { downloadFile(new Blob([JSON.stringify({ version: 1, document: doc, source, sourceName, reference, referenceName, prompt, date, project })], { type: 'application/json' }), 'fastway-brouillon.json'); }
  async function importDraft(file: File) {
    try { if (file.size > 80 * 1024 * 1024) throw new Error('Brouillon trop volumineux (80 Mo maximum).'); restore(parseDraft(JSON.parse(await file.text()))); setNotice('Brouillon importé. Vous pouvez reprendre la création.'); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Ce brouillon est invalide.'); }
  }
  async function upload(blob: Blob, name: string): Promise<Asset> {
    const form = new FormData(); form.set('file', new File([blob], name, { type: blob.type }));
    const response = await fetch('/api/files', { method: 'POST', body: form });
    if (!response.ok) throw new Error('Import dans le stockage impossible. Votre brouillon est conservé.');
    const asset = await studioResponse<Asset>(response);
    if (!validAsset(asset)) throw new StudioRequestError('Le fichier importé n’a pas été confirmé.', 'INVALID_RESPONSE');
    return asset;
  }
  async function save() {
    if (!canExport || saveLock.current || saved) return;
    saveLock.current = true; setSaving(true); setError(''); setNotice('');
    try {
      if (!date || !project.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Renseignez la date et le projet.');
      const signature = await fingerprint([doc, date, project]);
      if (pendingSave.current?.fingerprint !== signature) pendingSave.current = { fingerprint: signature, id: crypto.randomUUID() };
      keepSave(pendingSave.current);
      if (!pendingSave.current.asset) {
        const output = document.createElement('canvas'); await renderPoster(output, doc);
        pendingSave.current.asset = await upload(await canvasBlob(output), 'fastway-affiche.png');
        keepSave(pendingSave.current);
      }
      if (!pendingSave.current.thumbnail) {
        if (doc.thumbnailMode === 'custom' && doc.thumbnail) {
          const image = await dataFile(doc.thumbnail, 'fastway-miniature.png');
          pendingSave.current.thumbnail = await upload(image, image.name);
        } else pendingSave.current.thumbnail = pendingSave.current.asset;
        keepSave(pendingSave.current);
      }
      const { asset, thumbnail, id } = pendingSave.current;
      const post: Post = { id, title: doc.title.replace(/\n/g, ' ').trim(), date, project: project.trim(), status: 'En attente', caption: `${doc.price} $\n${doc.features}`, comment: '', drive: '', assets: [asset], thumbnail, updated: '' };
      const response = await fetch('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post) });
      await studioResponse<Post>(response);
      const check = await fetch('/api/posts', { cache: 'no-store' });
      const posts = await studioResponse<Post[]>(check);
      if (!Array.isArray(posts) || !posts.some(item => item.id === id)) throw new Error('Enregistrement non confirmé. Réessayez pour vérifier.');
      pendingSave.current.saved = true; keepSave(pendingSave.current);
      setSavedFingerprint(currentFingerprint); setNotice('Affiche enregistrée dans le calendrier, au statut En attente.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement impossible.'); }
    finally { saveLock.current = false; setSaving(false); }
  }
  function beginDrag(e: ReactPointerEvent<HTMLButtonElement>, field: 'title' | 'features') {
    if (busy) return;
    setSelectedText(field); setTab('text');
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX, startY = e.clientY;
    const x = field === 'title' ? doc.titleX : doc.featuresX;
    const y = field === 'title' ? doc.titleY : doc.featuresY;
    const width = stage.current?.getBoundingClientRect().width || 540;
    const move = (event: PointerEvent) => {
      const nextX = Math.max(20, Math.min(650, x + (event.clientX - startX) * POSTER_WIDTH / width));
      const nextY = Math.max(field === 'title' ? 180 : 260, Math.min(field === 'title' ? 560 : 620, y + (event.clientY - startY) * POSTER_WIDTH / width));
      setDoc(old => ({ ...old, [field + 'X']: Math.round(nextX), [field + 'Y']: Math.round(nextY) }));
    };
    const target = e.currentTarget;
    const end = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end);
  }

  return <div className={`fw-app ${full ? 'fw-focus' : ''}`}>
    <header className="fw-header"><Link href="/" className="fw-brand" aria-label="FASTWAY, retour au calendrier"><span className="fw-brand-mark">F<span>↗</span></span><span>FASTWAY<small>CREATIVE STUDIO</small></span></Link><nav><Link href="/studio" aria-current="page">Atelier de création</Link><Link href="/">Calendrier</Link></nav><div className="fw-save-indicator"><span/>{draftStatus}</div></header>
    <div className="fw-projectbar"><div><Link href="/" className="fw-back"><ArrowLeft size={14}/> Espace de travail</Link><h1>Votre prochaine création<span>.</span></h1><p>Du produit à l’affiche, gardez la main sur chaque détail.</p></div><div className="fw-project-actions"><button className="fw-button fw-quiet" onClick={exportDraft} disabled={!hydrated || busy}><Download size={15}/> Brouillon</button><button className="fw-button fw-dark" onClick={exportPNG} disabled={!canExport || busy}><Download size={16}/> Exporter le PNG</button></div></div>
    {storageError && <div className="fw-message fw-warning" role="status">{storageError}</div>}
    {error && <div className="fw-message fw-error" role="alert">{error}<button aria-label="Fermer l’erreur" onClick={() => setError('')}><X size={16}/></button></div>}
    {notice && <div className="fw-message fw-notice" role="status"><Check size={16}/>{notice}{saved && <Link href={`/?date=${date}`}>Voir dans le calendrier <ArrowRight size={14}/></Link>}<button aria-label="Fermer le message" onClick={() => setNotice('')}><X size={16}/></button></div>}
    <div className="fw-workspace" aria-busy={!hydrated}>
      <aside className="fw-controls"><div className="fw-tabs" role="tablist" aria-label="Étapes de création">{tabs.map((item, index) => <button id={`tab-${item.id}`} key={item.id} role="tab" disabled={!hydrated} aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { const next = tabs[(index + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; setTab(next.id); document.getElementById(`tab-${next.id}`)?.focus(); } }} onClick={() => setTab(item.id)}><item.icon size={17}/><span>{item.label}</span><small>0{index + 1}</small></button>)}</div>
      <fieldset disabled={!hydrated || busy} className="fw-fieldset">
      {tab === 'image' && <section id="panel-image" role="tabpanel" aria-labelledby="tab-image" className="fw-panel"><div className="fw-panel-heading"><span className="fw-overline">01 / LA MISE EN SCÈNE</span><h2>Donnez vie au produit.</h2><p>Importez votre produit et imaginez son décor. Le template s’occupe du reste.</p></div>
        <div className="fw-transposition-label"><Sparkles size={15}/><strong>Transposition Visuelle</strong><span>Deux images, deux rôles</span></div>
        <PictureInput label="1. Référence d’ambiance" value={reference} caption={referenceName || 'Décor, lumière et composition • facultatif'} onChange={file => void importPicture(file, 'reference')} onClear={() => { setReference(''); setReferenceName(''); }}/>
        <PictureInput label="2. Photo du produit" value={source} caption={sourceName || 'Le produit à préserver • PNG, JPG, WebP · 10 Mo'} onChange={file => void importPicture(file, 'source')}/>
        <div className="fw-rule"><span/>L’ambiance change. Le produit reste la référence.</div>
        <label className="fw-label">Décrivez votre décor<textarea aria-label="Décrivez votre décor" value={prompt} maxLength={2000} rows={4} onChange={e => setPrompt(e.target.value)} placeholder="Lumière, matières, couleurs, lieu…"/></label>
        <div className="fw-presets">{['Salon chaleureux', 'Studio minimaliste', 'Terrasse au soleil'].map((label, i) => <button type="button" key={label} onClick={() => setPrompt([defaultPrompt, 'Studio minimaliste, fond gris chaud, socle en pierre beige, éclairage latéral diffus, produit entier à droite et espace libre à gauche.', 'Terrasse contemporaine baignée de soleil, matériaux naturels et végétation floutée, produit entier à droite et espace libre à gauche.'][i])}>{label}</button>)}</div>
        <button className="fw-button fw-generate" type="button" onClick={() => void generate()} disabled={busy || checkingAI || !source || !prompt.trim() || !ai?.available}>{generating ? <Loader2 size={18} className="spin"/> : <Sparkles size={18}/>} {generating ? 'Création du décor en cours…' : 'Générer l’image du produit'}<span>IA</span></button>
        <p className={`fw-ai-status ${ai?.available ? 'is-ready' : ''}`}>{generating ? 'La génération peut prendre quelques minutes. Ne fermez pas cette page.' : ai ? ai.reason || (ai.verified ? 'Connexion IA vérifiée. Vérifiez les détails du produit généré.' : 'Clé détectée. Vérifiez la connexion avant de générer.') : 'Vérification de la connexion IA…'}</p><button type="button" className="fw-text-button" disabled={checkingAI || busy} onClick={() => void verifyConnection()}>{checkingAI ? <Loader2 size={13} className="spin"/> : <RotateCcw size={13}/>} {checkingAI ? 'Vérification…' : 'Vérifier la connexion IA'}</button>{ai?.configured && !ai.available && ai.code === 'AUTH_REQUIRED' && <Link className="fw-text-button" href="/signin-with-chatgpt?return_to=%2Fstudio">Se connecter pour générer <ArrowRight size={13}/></Link>}
        {variants.length > 0 && <div className="fw-variants" aria-label="Images générées">{variants.map(asset => <button key={asset.id} type="button" aria-label="Utiliser cette image générée" className={doc.photo === asset.url ? 'active' : ''} onClick={() => change('photo', asset.url)}><img src={asset.url} alt="Variante générée"/></button>)}</div>}
        <details className="fw-details"><summary>Importer une image déjà finalisée <ChevronDown size={15}/></summary><PictureInput label="Image principale de l’affiche" value={doc.photo && doc.photo !== source ? doc.photo : ''} caption="Utilisez une image créée ici ou dans un autre outil" onChange={file => void importPicture(file, 'scene')}/></details>
        <details className="fw-details"><summary>Placement et contraste <ChevronDown size={15}/></summary><Range label="Zoom de l’image" value={doc.photoScale} min={.5} max={2} step={.01} suffix=" %" onChange={value => change('photoScale', value)}/><Range label="Position horizontale" value={doc.photoX} min={-400} max={400} onChange={value => change('photoX', value)}/><Range label="Position verticale" value={doc.photoY} min={-400} max={400} onChange={value => change('photoY', value)}/><Range label="Contraste derrière les textes" value={doc.shade} min={0} max={1} step={.01} suffix=" %" onChange={value => change('shade', value)}/></details>
        <button className="fw-next" type="button" onClick={() => setTab('thumbnail')}>Choisir la miniature <ArrowRight size={16}/></button>
      </section>}
      {tab === 'thumbnail' && <section id="panel-thumbnail" role="tabpanel" aria-labelledby="tab-thumbnail" className="fw-panel"><div className="fw-panel-heading"><span className="fw-overline">02 / LE DÉTAIL QUI COMPTE</span><h2>Une miniature à part.</h2><p>Choisissez l’image du petit encart sur votre affiche, indépendamment de la scène principale.</p></div>
        <div className="fw-radio-cards">{([{ mode: 'auto', title: 'Image principale', desc: 'La même photo, affichée en entier.' }, { mode: 'custom', title: 'Image personnalisée', desc: 'Un autre angle, un packshot ou un détail.' }, { mode: 'none', title: 'Sans miniature', desc: 'Masquer l’encart sur cette affiche.' }] as const).map(item => <label key={item.mode} className={doc.thumbnailMode === item.mode ? 'selected' : ''}><input type="radio" name="thumbnailMode" value={item.mode} checked={doc.thumbnailMode === item.mode} onChange={() => change('thumbnailMode', item.mode)}/><span><strong>{item.title}</strong><small>{item.desc}</small></span>{doc.thumbnailMode === item.mode && <Check size={16}/>}</label>)}</div>
        {doc.thumbnailMode === 'custom' && <><PictureInput label="Importer la miniature" value={doc.thumbnail} caption="PNG, JPG ou WebP · 10 Mo maximum" onChange={file => void importPicture(file, 'thumbnail')} onClear={() => change('thumbnail', '')}/>{!doc.thumbnail && <p className="fw-ai-status">Importez une image pour afficher votre miniature personnalisée.</p>}</>}
        {doc.thumbnailMode !== 'none' && <div className="fw-miniature-preview">{(doc.thumbnailMode === 'custom' ? doc.thumbnail : doc.photo) ? <img src={doc.thumbnailMode === 'custom' ? doc.thumbnail : doc.photo} alt="Aperçu miniature indépendante"/> : <ImagePlus size={32}/>}<span>Affichage entier<br/><small>Sans déformation du produit</small></span></div>}
        <div className="fw-tip"><Layers3 size={18}/><p>La miniature personnalisée sera aussi utilisée comme couverture dans votre calendrier.</p></div><button className="fw-next" type="button" onClick={() => setTab('text')}>Écrire les textes <ArrowRight size={16}/></button></section>}
      {tab === 'text' && <section id="panel-text" role="tabpanel" aria-labelledby="tab-text" className="fw-panel"><div className="fw-panel-heading"><span className="fw-overline">03 / VOTRE MESSAGE</span><h2>Les mots sont à vous.</h2><p>Écrivez, ajustez, déplacez. Vos textes restent éditables jusqu’à l’export.</p></div>
        <label className="fw-label">Nom du produit<textarea aria-label="Nom du produit" rows={2} maxLength={150} value={doc.title} onFocus={() => setSelectedText('title')} onChange={e => change('title', e.target.value)} placeholder="Ex. Robe bleu ciel"/></label>
        <div className="fw-row"><label className="fw-label">Prix en dollars<input type="number" min="0.01" max="999999" step="0.01" value={doc.price} onChange={e => change('price', e.target.value)} placeholder="85"/></label><div className="fw-price-unit">USD <span>$</span></div></div>
        <label className="fw-label">Description et caractéristiques<textarea aria-label="Description et caractéristiques" rows={4} maxLength={600} value={doc.features} onFocus={() => setSelectedText('features')} onChange={e => change('features', e.target.value)} placeholder={'Col blanc perlé\nCoupe évasée sans manches'}/></label>
        <details className="fw-details" open><summary>Taille et position des textes <Move size={15}/></summary><div className="fw-segment"><button type="button" className={selectedText === 'title' ? 'active' : ''} onClick={() => setSelectedText('title')}>Titre</button><button type="button" className={selectedText === 'features' ? 'active' : ''} onClick={() => setSelectedText('features')}>Description</button></div><Range label="Taille du texte" value={selectedText === 'title' ? doc.titleSize : doc.featuresSize} min={selectedText === 'title' ? 24 : 18} max={selectedText === 'title' ? 90 : 44} suffix=" px" onChange={value => change(selectedText === 'title' ? 'titleSize' : 'featuresSize', value)}/><Range label="Position du texte X" value={selectedText === 'title' ? doc.titleX : doc.featuresX} min={20} max={650} onChange={value => change(selectedText === 'title' ? 'titleX' : 'featuresX', value)}/><Range label="Position du texte Y" value={selectedText === 'title' ? doc.titleY : doc.featuresY} min={selectedText === 'title' ? 180 : 260} max={selectedText === 'title' ? 560 : 620} onChange={value => change(selectedText === 'title' ? 'titleY' : 'featuresY', value)}/><p className="fw-help">Vous pouvez aussi déplacer les poignées dans l’aperçu. Un texte trop long doit être raccourci.</p></details>
        <details className="fw-details"><summary>Mentions du template <ChevronDown size={15}/></summary>{([{ key: 'headline', label: 'Accroche' }, { key: 'subheadline', label: 'Seconde ligne' }, { key: 'phone', label: 'Numéro de commande' }, { key: 'cta', label: 'Appel à l’action' }, { key: 'deliveryTitle', label: 'Titre livraison' }, { key: 'deliveryRoute', label: 'Trajet et délai' }] as const).map(item => <label className="fw-label" key={item.key}>{item.label}<input value={doc[item.key]} maxLength={100} onChange={e => change(item.key, e.target.value)}/></label>)}<button type="button" className="fw-text-button" onClick={() => setDoc(old => ({ ...old, headline: DEFAULT_STUDIO_DOCUMENT.headline, subheadline: DEFAULT_STUDIO_DOCUMENT.subheadline, phone: DEFAULT_STUDIO_DOCUMENT.phone, cta: DEFAULT_STUDIO_DOCUMENT.cta, deliveryTitle: DEFAULT_STUDIO_DOCUMENT.deliveryTitle, deliveryRoute: DEFAULT_STUDIO_DOCUMENT.deliveryRoute }))}><RotateCcw size={13}/> Rétablir les mentions FASTWAY</button></details>
        <details className="fw-details"><summary>Votre calque de template <ChevronDown size={15}/></summary><p className="fw-help">Importez votre template en PNG transparent, sans photo ni textes variables. Il remplacera le bandeau et le logo dessinés par défaut. Effacez les mentions ci-dessus si elles sont déjà sur le calque.</p><PictureInput label="Calque du template (PNG)" value={doc.templateOverlay} caption="Le calque exact de votre identité visuelle" onChange={file => void importPicture(file, 'overlay')} onClear={() => change('templateOverlay', '')}/></details>
      </section>}
      </fieldset><div className="fw-controls-footer"><button type="button" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={14}/> Ouvrir un brouillon</button><input hidden ref={fileRef} type="file" accept="application/json,.json" onChange={e => { if (e.target.files?.[0]) void importDraft(e.target.files[0]); e.target.value = ''; }}/><span>FASTWAY · 4:5</span></div></aside>
      <section className="fw-preview-area" aria-label="Aperçu de l’affiche"><div className="fw-preview-toolbar"><div><span className="fw-live-dot"/> Aperçu en direct <span className="fw-format">1080 × 1350</span></div><button type="button" aria-label={full ? 'Quitter le mode aperçu' : 'Agrandir l’aperçu'} onClick={() => setFull(!full)}><Maximize2 size={16}/></button></div>
        <div className="fw-preview-scroll"><div className="fw-poster-wrap"><div className="fw-poster" ref={stage}><canvas ref={canvas} width={POSTER_WIDTH} height={POSTER_HEIGHT} aria-label="Affiche FASTWAY avec vos images et vos textes"/>{tab === 'text' && !isExample && <>{(['title', 'features'] as const).map(field => <button type="button" key={field} className={`fw-text-handle ${selectedText === field ? 'active' : ''}`} style={{ left: `${doc[field === 'title' ? 'titleX' : 'featuresX'] / POSTER_WIDTH * 100}%`, top: `${(doc[field === 'title' ? 'titleY' : 'featuresY'] - 20) / POSTER_HEIGHT * 100}%` }} aria-label={`Déplacer ${field === 'title' ? 'le titre' : 'la description'}`} onPointerDown={e => beginDrag(e, field)}><Move size={13}/>{field === 'title' ? 'Titre' : 'Description'}</button>)}</>}{!rendered && <div className="fw-render-overlay">{renderError || <Loader2 className="spin"/>}</div>}</div><div className="fw-preview-caption"><span>{isExample ? 'Exemple de mise en page · importez votre produit' : 'Template FASTWAY · vos textes, vos images'}</span><span>PNG · 4:5</span></div></div></div>
        {renderError && <p className="fw-canvas-error" role="alert">{renderError}</p>}
        <div className="fw-template-note"><span className="fw-template-icon"><Layers3 size={18}/></span><div><strong>Votre identité, toujours en place.</strong><p>Logo, bandeau, coordonnées et livraison. Aucun pictogramme ajouté aux caractéristiques.</p></div><span className="fw-template-tag">FASTWAY ORIGINAL</span></div>
      </section>
    </div>
    <footer className="fw-bottom-bar"><div className="fw-publish-info"><span className="fw-overline">PRÊT À PLANIFIER ?</span><strong>Une création. Un seul endroit.</strong></div><label>Date de publication<input type="date" value={date} aria-label="Date de publication" onChange={e => setDate(e.target.value)} disabled={busy}/></label><label>Projet<input value={project} aria-label="Projet" maxLength={80} onChange={e => setProject(e.target.value)} disabled={busy}/></label><button className="fw-button fw-primary" disabled={!canExport || busy || saved || !date || !project.trim()} onClick={() => void save()}>{saving ? <Loader2 size={17} className="spin"/> : saved ? <Check size={17}/> : <Save size={17}/>} {saving ? 'Enregistrement…' : saved ? 'Enregistré dans le calendrier' : 'Enregistrer dans le calendrier'}</button></footer>
  </div>;
}
