// Assembles the single self-contained index.html:
//   three.js (bundled + minified, exposed as global THREE)  +  src/*.js concatenated in name order.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cache = path.join(here, '.cache', 'three.iife.min.js');

if (!fs.existsSync(cache)) {
  const entry = path.join(here, '.cache', 'three-entry.js');
  fs.writeFileSync(entry, "export * from 'three';\n");
  await build({
    entryPoints: [entry], bundle: true, minify: true, format: 'iife', globalName: 'THREE',
    outfile: cache, target: 'es2020', legalComments: 'none', absWorkingDir: here,
  });
}
const three = fs.readFileSync(cache, 'utf8').replace(/<\/script/gi, '<\\/script');
const ver = JSON.parse(fs.readFileSync(path.join(here, 'node_modules/three/package.json'), 'utf8')).version;

const srcDir = path.join(root, 'src');
const parts = fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort();
let app = parts.map(f => `// ───────────────────────── ${f} ─────────────────────────\n` + fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');
app = app.replace(/<\/script/gi, '<\\/script');

const shell = fs.readFileSync(path.join(srcDir, 'shell.html'), 'utf8');
const html = shell
  .replace('/*__THREE__*/', () => `/* three.js r${ver} — MIT License — https://threejs.org */\n` + three)
  .replace('/*__APP__*/', () => app);
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log(`index.html  ${(html.length / 1024).toFixed(0)} KB  (three ${(three.length / 1024).toFixed(0)} KB, app ${(app.length / 1024).toFixed(0)} KB, ${parts.length} parts)`);
