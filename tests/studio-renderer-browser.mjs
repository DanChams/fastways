// Real canvas regressions; install playwright-core outside the checkout.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.STUDIO_BASE_URL || 'http://127.0.0.1:8789';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Use a local studio server.');
const source = await readFile(new URL('../lib/studio-renderer.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(); await page.goto(base + '/studio');
  await page.addScriptTag({ content: `(() => { const exports = {}; ${outputText}; window.StudioRenderer = exports; })();` });
  const result = await page.evaluate(async () => {
    const { renderPoster, DEFAULT_STUDIO_DOCUMENT, canvasBlob } = window.StudioRenderer;
    const canvas = document.createElement('canvas');
    const doc = { ...DEFAULT_STUDIO_DOCUMENT, photo: '/studio-demo.png', title: 'Robe', price: '85', features: 'Bleue' };
    const accepted = [];
    for (const [name, changes] of [
      ['default layout', {}],
      ['short texts beside each other', { featuresX: 400, featuresY: 260 }],
      ['right-side description beside price', { featuresX: 650, featuresY: 620, features: 'Une description sur\nplusieurs lignes séparées' }],
      ['minimum monetary amount', { price: '0.01' }],
    ]) {
      try { await renderPoster(canvas, { ...doc, ...changes }); accepted.push([name, true]); }
      catch (e) { accepted.push([name, false, e.message]); }
    }
    const rejected = [];
    for (const [name, changes, message] of [
      ['actual text collision', { featuresY: 260 }, 'superposent'],
      ['custom thumbnail missing', { thumbnailMode: 'custom' }, 'miniature'],
      ['incorrect overlay ratio', { templateOverlay: '/fastway-logo.png' }, '4:5'],
      ['subcent price', { price: '0.001' }, 'prix'],
      ['three decimal price', { price: '1.005' }, 'prix'],
      ['price above limit', { price: '1000000' }, 'prix'],
    ]) {
      try { await renderPoster(canvas, { ...doc, ...changes }); rejected.push([name, false, 'No error']); }
      catch (e) { rejected.push([name, e.message.includes(message), e.message]); }
    }
    const blob = await canvasBlob(canvas);
    return { accepted, rejected, width: canvas.width, height: canvas.height, type: blob.type, bytes: blob.size };
  });
  for (const [name, ok, message] of [...result.accepted, ...result.rejected]) assert.ok(ok, `${name}: ${message}`);
  assert.equal(result.width, 1080); assert.equal(result.height, 1350); assert.equal(result.type, 'image/png'); assert.ok(result.bytes > 10000);
  console.log(`Canvas: ${result.accepted.length} valid layouts and ${result.rejected.length} error cases verified; PNG 1080 × 1350 exported.`);
} finally { await browser.close(); }
