/** Browser-only composition. The product photo is never stretched or redrawn. */
export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1350;

export type StudioDocument = {
  title: string;
  price: string;
  features: string;
  headline: string;
  subheadline: string;
  phone: string;
  deliveryTitle: string;
  deliveryRoute: string;
  cta: string;
  photo: string;
  thumbnail: string;
  thumbnailMode: 'auto' | 'custom' | 'none';
  photoScale: number;
  photoX: number;
  photoY: number;
  shade: number;
  titleSize: number;
  featuresSize: number;
  titleX: number;
  titleY: number;
  featuresX: number;
  featuresY: number;
  templateOverlay: string;
};

export const DEFAULT_STUDIO_DOCUMENT: StudioDocument = {
  title: '', price: '', features: '',
  headline: 'DÉCOUVREZ LE CONFORT', subheadline: 'À PRIX ABORDABLE !',
  phone: '+243 830 894 663', deliveryTitle: 'LIVRAISON PARTOUT EN RDC',
  deliveryRoute: 'Afrique du Sud → RDC en 7–10 jours', cta: 'Commandez maintenant',
  photo: '', thumbnail: '', thumbnailMode: 'auto',
  photoScale: 1, photoX: 0, photoY: 0, shade: 0.65,
  titleSize: 62, featuresSize: 31, titleX: 32, titleY: 255,
  featuresX: 32, featuresY: 450, templateOverlay: '',
};

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function image(url: string): Promise<HTMLImageElement> {
  if (!url) return Promise.reject(new Error('Ajoutez une image.'));
  if (!/^(data:image\/(png|jpeg|webp);base64,|blob:|\/(?!\/))/.test(url)) {
    return Promise.reject(new Error('Importez cette image depuis votre appareil.'));
  }
  let result = imageCache.get(url);
  if (!result) {
    result = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => img.naturalWidth * img.naturalHeight <= 40_000_000
        ? resolve(img) : reject(new Error('Image trop grande : maximum 40 mégapixels.'));
      img.onerror = () => { imageCache.delete(url); reject(new Error('Impossible de lire cette image. Importez un PNG, JPEG ou WebP valide.')); };
      img.src = url;
    });
    imageCache.set(url, result);
    // Uploaded images can be large. Keep only a small recent set.
    if (imageCache.size > 8) imageCache.delete(imageCache.keys().next().value!);
  }
  return result;
}

export async function readStudioImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size === 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('Choisissez une image PNG, JPEG ou WebP de 10 Mo maximum.');
  }
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Lecture de l’image impossible.'));
    reader.readAsDataURL(file);
  });
  await image(url);
  return url;
}

function lines(c: CanvasRenderingContext2D, text: string, width: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) { result.push(''); continue; }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      // A long unbroken word must not disappear past the canvas edge.
      if (c.measureText(word).width > width) {
        if (line) { result.push(line); line = ''; }
        let fragment = '';
        for (const character of word) {
          if (c.measureText(fragment + character).width > width && fragment) { result.push(fragment); fragment = ''; }
          fragment += character;
        }
        line = fragment;
      } else if (line && c.measureText(`${line} ${word}`).width > width) {
        result.push(line); line = word;
      } else line += `${line ? ' ' : ''}${word}`;
    }
    if (line) result.push(line);
  }
  return result;
}

type Box = { x: number; y: number; width: number; height: number };
function overlaps(a: Box, b: Box) {
  return a.height > 0 && b.height > 0 && a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}
function fit(c: CanvasRenderingContext2D, text: string, box: Box, size: number, min: number, bold: boolean, label: string): Box {
  if (!text.trim()) return { ...box, height: 0 };
  let rows: string[] = [];
  let actual = size;
  for (; actual >= min; actual--) {
    c.font = `${bold ? '700' : '400'} ${actual}px Arial, sans-serif`;
    rows = lines(c, text, box.width);
    if (rows.length * actual * 1.18 <= box.height) break;
  }
  if (actual < min) throw new Error(`Le texte « ${label} » est trop long. Raccourcissez-le ou réduisez sa taille.`);
  c.textBaseline = 'top';
  for (const [index, row] of rows.entries()) c.fillText(row, box.x, box.y + index * actual * 1.18);
  return { ...box, width: Math.max(0, ...rows.map(row => c.measureText(row).width)), height: rows.length * actual * 1.18 };
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, fill: string) {
  c.fillStyle = fill; c.beginPath(); c.roundRect(x, y, w, h, radius); c.fill();
}

function contain(c: CanvasRenderingContext2D, img: HTMLImageElement, box: Box) {
  const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  c.drawImage(img, box.x + (box.width - w) / 2, box.y + (box.height - h) / 2, w, h);
}

function number(value: number, min: number, max: number, label: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Réglage « ${label} » hors limites.`);
  return value;
}

/**
 * A custom overlay replaces only the generated footer curves and logo.
 * Editable contact/delivery fields are drawn above it. For a branded footer
 * that already contains those fields, clear the corresponding text fields.
 */
export async function renderPoster(canvas: HTMLCanvasElement, doc: StudioDocument): Promise<void> {
  if (doc.thumbnailMode === 'custom' && !doc.thumbnail) {
    throw new Error('Importez votre miniature personnalisée ou choisissez le mode « Image principale ».');
  }
  const product = doc.photo ? await image(doc.photo) : null;
  const miniature = doc.thumbnailMode === 'custom' && doc.thumbnail ? await image(doc.thumbnail)
    : doc.thumbnailMode === 'auto' ? product : null;
  const overlay = doc.templateOverlay ? await image(doc.templateOverlay) : null;
  if (overlay && Math.abs(overlay.naturalWidth / overlay.naturalHeight - POSTER_WIDTH / POSTER_HEIGHT) > .008) {
    throw new Error('Le calque doit être au format 4:5 (par exemple 1080 × 1350 px) pour conserver les proportions du template.');
  }
  const logo = overlay ? null : await image('/fastway-logo.png');
  const scale = number(doc.photoScale, .5, 3, 'zoom photo');
  const photoX = number(doc.photoX, -700, 700, 'position photo');
  const photoY = number(doc.photoY, -700, 700, 'position photo');
  const shade = number(doc.shade, 0, 1, 'contraste');
  number(doc.titleX, 0, 950, 'position du titre'); number(doc.titleY, 150, 750, 'position du titre');
  number(doc.featuresX, 0, 950, 'position du descriptif'); number(doc.featuresY, 150, 780, 'position du descriptif');
  number(doc.titleSize, 24, 100, 'taille du titre'); number(doc.featuresSize, 18, 60, 'taille du descriptif');
  if (doc.price !== '' && (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(doc.price) || !Number.isFinite(Number(doc.price)) || Number(doc.price) < .01 || Number(doc.price) > 999999)) {
    throw new Error('Indiquez un prix compris entre 0,01 et 999 999 $, avec deux décimales maximum.');
  }
  // Render offscreen so a failed redraw never leaves a half-finished export.
  const buffer = document.createElement('canvas'); buffer.width = POSTER_WIDTH; buffer.height = POSTER_HEIGHT;
  const c = buffer.getContext('2d');
  if (!c) throw new Error('Ce navigateur ne peut pas composer le visuel.');
  c.fillStyle = '#b4ada3'; c.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  if (product) {
    const ratio = Math.max(POSTER_WIDTH / product.naturalWidth, 1140 / product.naturalHeight) * scale;
    const w = product.naturalWidth * ratio, h = product.naturalHeight * ratio;
    c.drawImage(product, (POSTER_WIDTH - w) / 2 + photoX, (1140 - h) / 2 + photoY, w, h);
  } else {
    const placeholder = c.createLinearGradient(0, 0, POSTER_WIDTH, 1080);
    placeholder.addColorStop(0, '#303c49'); placeholder.addColorStop(1, '#d1c5b6');
    c.fillStyle = placeholder; c.fillRect(0, 0, POSTER_WIDTH, 1150);
  }
  const dark = c.createLinearGradient(0, 0, 850, 0);
  dark.addColorStop(0, `rgba(6,15,28,${shade})`); dark.addColorStop(.6, `rgba(6,15,28,${shade * .65})`); dark.addColorStop(1, 'rgba(6,15,28,0)');
  c.fillStyle = dark; c.fillRect(0, 0, POSTER_WIDTH, 1160);

  if (overlay) c.drawImage(overlay, 0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  else {
    c.fillStyle = '#00b9ef'; c.beginPath(); c.moveTo(0, 1060); c.bezierCurveTo(300, 1240, 830, 1050, 1080, 900); c.lineTo(1080, 1350); c.lineTo(0, 1350); c.fill();
    c.fillStyle = '#f6fbff'; c.beginPath(); c.moveTo(0, 1090); c.bezierCurveTo(300, 1260, 830, 1080, 1080, 930); c.lineTo(1080, 1350); c.lineTo(0, 1350); c.fill();
    roundRect(c, 28, 1110, 355, 300, 65, '#04489c');
    if (logo) contain(c, logo, { x: 844, y: 992, width: 210, height: 195 });
  }

  c.fillStyle = '#fff';
  const headlineBox = fit(c, doc.headline, { x: 32, y: 52, width: 770, height: 48 }, 34, 20, true, 'accroche');
  const subheadlineBox = fit(c, doc.subheadline, { x: 32, y: 101, width: 780, height: 60 }, 43, 22, true, 'sous-titre');
  const titleBox = fit(c, doc.title, { x: doc.titleX, y: doc.titleY, width: Math.min(510, 1048 - doc.titleX), height: 185 }, doc.titleSize, 24, true, 'titre');
  const featureBox = fit(c, doc.features, { x: doc.featuresX, y: doc.featuresY, width: Math.min(475, 1048 - doc.featuresX), height: 170 }, doc.featuresSize, 18, false, 'caractéristiques');
  if (overlaps(titleBox, featureBox)) {
    throw new Error('Le titre et les caractéristiques se superposent. Déplacez un bloc de texte.');
  }
  if ([titleBox, featureBox].some(box => overlaps(box, headlineBox) || overlaps(box, subheadlineBox))) {
    throw new Error('Un bloc de texte recouvre l’accroche. Descendez-le pour garder les textes lisibles.');
  }
  if ([titleBox, featureBox].some(box => box.height > 0 && box.y + box.height > 900)) {
    throw new Error('Un bloc de texte descend sur le bandeau FASTWAY. Remontez-le.');
  }
  if (miniature && [titleBox, featureBox].some(box => overlaps(box, { x: 32, y: 830, width: 235, height: 240 }))) {
    throw new Error('Un bloc de texte recouvre la miniature. Remontez-le ou déplacez-le vers la droite.');
  }
  // Only text in the price column can push its badge down. A description moved
  // to the right must not block export merely because it sits beside the price.
  const bottom = Math.max(0, ...[titleBox, featureBox]
    .filter(box => box.height > 0 && box.x < 407 && box.x + box.width > 32)
    .map(box => box.y + box.height));
  const priceTop = Math.max(646, bottom + 24);
  if (priceTop > 680 && doc.price) throw new Error('Les textes descendent trop bas. Remontez-les pour laisser la place au prix et à la miniature.');
  if (doc.price) {
    roundRect(c, 32, priceTop, 375, 139, 28, '#ffe100');
    c.fillStyle = '#002e75';
    const formatted = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(doc.price));
    fit(c, `${formatted} $`, { x: 48, y: priceTop + 18, width: 344, height: 107 }, 104, 38, true, 'prix');
  }
  if (miniature) {
    roundRect(c, 32, 830, 235, 240, 25, '#fff');
    c.save(); c.beginPath(); c.roundRect(40, 838, 219, 224, 18); c.clip();
    contain(c, miniature, { x: 43, y: 841, width: 213, height: 218 }); c.restore();
  }

  c.fillStyle = '#fff'; fit(c, doc.phone, { x: 44, y: 1191, width: 325, height: 53 }, 36, 18, true, 'téléphone');
  c.fillStyle = '#00c7f5'; fit(c, doc.cta, { x: 65, y: 1251, width: 288, height: 94 }, 40, 20, true, 'commande');
  c.fillStyle = '#00b9ed'; fit(c, doc.deliveryTitle, { x: 427, y: 1192, width: 600, height: 78 }, 32, 19, true, 'livraison');
  c.fillStyle = '#087bc5'; fit(c, doc.deliveryRoute, { x: 427, y: 1290, width: 620, height: 46 }, 27, 16, true, 'trajet');
  canvas.width = POSTER_WIDTH; canvas.height = POSTER_HEIGHT;
  const output = canvas.getContext('2d');
  if (!output) throw new Error('Ce navigateur ne peut pas afficher le visuel.');
  output.drawImage(buffer, 0, 0);
}

export async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Export PNG impossible.')), 'image/png'); }
    catch { reject(new Error('Export impossible : utilisez des images importées depuis votre appareil.')); }
  });
}
