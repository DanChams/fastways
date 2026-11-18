import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.STUDIO_BASE_URL || 'http://127.0.0.1:8790';
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)) throw new Error('Serveur local requis.');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const ids = [];
try {
  const keys = []; let probe = 'invalid'; let fileUploads = 0; let firstPost = true; const postIds = [];
  await page.route('**/api/studio-image**', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      const checking = new URL(request.url()).searchParams.has('check');
      const invalid = checking && probe === 'invalid';
      await route.fulfill({ json: { configured: true, available: !invalid, verified: checking && !invalid, code: invalid ? 'INVALID_API_KEY' : checking ? 'READY' : 'UNVERIFIED', reason: invalid ? 'Clé invalide ou révoquée : test contrôlé.' : checking ? 'Connexion vérifiée : test contrôlé.' : 'Clé détectée, connexion non vérifiée.' } });
    } else {
      keys.push(request.headers()['idempotency-key']);
      if (keys.length === 1) await route.abort('failed');
      else await route.fulfill({ status: 409, json: { error: 'Génération indéterminée : test contrôlé.', code: 'GENERATION_INDETERMINATE', jobState: 'indeterminate', retryable: false } });
    }
  });
  await page.goto(base + '/studio');
  await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
  await page.getByLabel('2. Photo du produit', { exact: true }).setInputFiles(new URL('../public/studio-demo.png', import.meta.url).pathname);
  const generate = () => page.getByRole('button', { name: 'Générer l’image du produit' });
  await generate().click(); await page.getByRole('alert').filter({ hasText: 'Connexion interrompue' }).waitFor();
  await page.waitForTimeout(900); await page.reload();
  await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
  await generate().click(); await page.getByRole('alert').filter({ hasText: 'Génération indéterminée' }).waitFor();
  await generate().click(); await page.getByRole('alert').filter({ hasText: 'Génération indéterminée' }).waitFor();
  assert.equal(keys.length, 3); assert.equal(new Set(keys).size, 1, 'A reload or indeterminate status must never start a second paid request.');
  const verify = page.getByRole('button', { name: 'Vérifier la connexion IA', exact: true });
  await verify.click(); await page.getByText('Clé invalide ou révoquée : test contrôlé.', { exact: true }).waitFor();
  assert.equal(await generate().isDisabled(), true);
  probe = 'ready'; await verify.click(); await page.getByText('Connexion vérifiée : test contrôlé.', { exact: true }).waitFor();
  assert.equal(await generate().isDisabled(), false);
  // A lost save response can occur after the server actually commits the post.
  await page.route('**/api/files', async route => { if (route.request().method() === 'POST') fileUploads++; await route.continue(); });
  await page.route('**/api/posts', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const post = route.request().postDataJSON(); postIds.push(post.id); if (!ids.includes(post.id)) ids.push(post.id);
    if (firstPost) { firstPost = false; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('tab', { name: /Miniature/ }).click();
  await page.getByLabel('Image personnalisée').check();
  await page.getByLabel('Importer la miniature', { exact: true }).setInputFiles(new URL('../public/fastway-logo.png', import.meta.url).pathname);
  await page.getByRole('tab', { name: /Textes/ }).click();
  await page.getByLabel('Nom du produit', { exact: true }).fill('Test reprise ' + Date.now());
  await page.getByLabel('Prix en dollars', { exact: true }).fill('85');
  const save = () => page.getByRole('button', { name: 'Enregistrer dans le calendrier', exact: true });
  await save().click(); await page.waitForFunction(() => { const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Enregistrer dans le calendrier')); return button && !button.disabled; });
  await page.getByRole('alert').waitFor(); assert.equal(fileUploads, 2);
  await page.waitForTimeout(900); await page.reload(); await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
  await save().click(); await page.getByRole('button', { name: 'Enregistré dans le calendrier', exact: true }).waitFor();
  assert.equal(fileUploads, 2, 'Retry after reload must reuse the uploaded poster and thumbnail.');
  assert.equal(new Set(postIds).size, 1, 'Retry after a committed but lost response must reuse the post ID.');
  const posts = await (await page.request.get(base + '/api/posts')).json();
  assert.equal(posts.filter(post => post.id === ids[0]).length, 1);
  console.log('PASS: browser error simulation only (no paid image calls): network+reload+indeterminate reuse one generation key; revoked/verified connection statuses; committed-lost calendar response retries with same ID and uploaded files.');
} finally {
  for (const id of ids) await page.request.delete(base + '/api/posts', { data: { id } }).catch(() => {});
  await browser.close();
}
