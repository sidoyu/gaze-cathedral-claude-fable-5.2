// Headless capture harness (software GL). Usage:
//   node tools/shot.mjs out.png [key=value ...]     e.g. yaw=0 pitch=0 frames=10 w=960 h=540 stage=3
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const [out, ...kv] = process.argv.slice(2);
const P = Object.fromEntries(kv.map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
const w = +(P.w || 960), h = +(P.h || 540);
const t0 = Date.now();
const browser = await chromium.launch({ headless: true, args: ['--single-process', '--in-process-gpu', '--no-zygote', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => { const t = m.text(); if (!/GPU stall|Automatic fallback/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + (e.stack || e.message)));
const hash = '#shot&' + kv.filter(s => !s.startsWith('dbg=') && !s.startsWith('pre=')).join('&');
await page.goto('file://' + path.join(root, P.page || 'index.html') + hash);
let res;
try {
  await page.waitForFunction(() => window.__gaze && (window.__gaze.ready || window.__gaze.error), null, { timeout: +(P.timeout || 600000) });
  res = await page.evaluate(async (P) => {
    if (window.__gaze.error) return { error: window.__gaze.error };
    return await window.__gaze.shot(P);
  }, P);
} catch (e) { res = { error: String(e) }; }
for (const l of logs.slice(0, 60)) console.log(l);
if (res && res.png) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(res.png.split(',')[1], 'base64'));
  console.log(`saved ${out}  ${((Date.now() - t0) / 1000).toFixed(1)}s`, res.info ? JSON.stringify(res.info) : '');
} else console.log('NO IMAGE', res && res.error);
await browser.close();
