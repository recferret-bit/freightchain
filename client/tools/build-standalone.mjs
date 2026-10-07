// Builds dist/freightchain.html: ONE file (CSS + all game modules inlined) that works when double-clicked (file://).
// three.js is still loaded from the CDN via the importmap, so it needs internet. Usage: node tools/build-standalone.mjs
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const viewer = process.argv[2] === 'viewer', entry = viewer ? 'viewer' : 'main', page = viewer ? 'viewer.html' : 'play.html', out = viewer ? 'dist/viewer.html' : 'dist/freightchain.html';   // `node tools/build-standalone.mjs viewer` → dist/viewer.html
const tmp = path.join(os.tmpdir(), `fc-bundle-${entry}.js`);
execFileSync('npx', ['--yes', 'esbuild', `js/${entry}.js`, '--bundle', '--external:three', '--format=esm', `--outfile=${tmp}`, '--log-level=warning'], { cwd: root, stdio: 'inherit' });
const bundle = fs.readFileSync(tmp, 'utf8').replace(/<\/script/gi, '<\\/script');
let html = fs.readFileSync(path.join(root, page), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${css}</style>`)
           .replace(new RegExp(`<script type="module" src="js/${entry}\\.js"></script>`), () => `<script type="module">\n${bundle}</script>`)
           .replace(/<script>\s*(?:\/\/ If the modules didn't start|setTimeout\(\(\) => \{ if \(!window\.__viewer\))[\s\S]*?<\/script>/, '');   // the "could not start" helper is only for the multi-file build
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, out), html);
console.log('wrote ' + out + ' (' + Math.round(html.length / 1024) + ' KB)');
