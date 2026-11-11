// Headless logic/audio probes. usage: node tools/probe.mjs "<js expression evaluated in page, may await>"
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ headless: true, args: ['--single-process', '--in-process-gpu', '--no-zygote', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const logs = [];
page.on('console', m => { const t = m.text(); if (!/GPU stall|Automatic fallback/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + (e.stack || e.message)));
await page.goto('file://' + path.join(root, 'index.html') + '#shot&low=1&lowtex=1&lowgeo=1');
await page.waitForFunction(() => window.__gaze && (window.__gaze.ready || window.__gaze.error), null, { timeout: 300000 });
try {
  const res = await page.evaluate(async (src) => await window.__gaze.ev('(async () => (' + src + '))()'), process.argv[2]);
  console.log(typeof res === 'string' ? res : JSON.stringify(res, null, 1));
} catch (e) { console.log('EVAL ERROR', String(e)); }
for (const l of logs.slice(0, 40)) console.log(l);
await browser.close();
