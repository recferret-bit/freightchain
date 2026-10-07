import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* Static checks on index.html + src/main.js: the things that otherwise only fail at runtime in a browser (a null getElementById, a dead anchor, a missing image). */
const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(join(root, 'index.html'), 'utf8'), main = readFileSync(join(root, 'src/main.js'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);

test('element ids are unique', () => { assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), []); });

test('every $("id") in main.js exists in the page', () => {
  const used = [...new Set([...main.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]))];
  assert.deepEqual(used.filter(u => !ids.includes(u)), []);
});

test('every in-page anchor points at an element', () => {
  const hrefs = [...new Set([...html.matchAll(/href="#([\w-]+)"/g)].map(m => m[1]))];
  assert.deepEqual(hrefs.filter(h => !ids.includes(h)), []);
});

test('every nav link has a chapter section and vice versa', () => {
  const nav = [...html.matchAll(/<nav class="nav"[\s\S]*?<\/nav>/g)][0][0], links = [...nav.matchAll(/href="#([\w-]+)"/g)].map(m => m[1]);
  const sections = [...html.matchAll(/<section[^>]*\bid="([\w-]+)"/g)].map(m => m[1]);
  assert.deepEqual([...links].sort(), [...sections].sort());
});

test('every local /media file the page names exists in public/', () => {
  const files = [...new Set([...html.matchAll(/["'(](\/media\/[\w./-]+)/g)].map(m => m[1]))];
  assert.ok(files.length > 10);
  assert.deepEqual(files.filter(f => !existsSync(join(root, 'public', f))), []);
});

test('no orphan media: every file in public/media is used by the page or the scripts', () => {
  const src = html + main + readFileSync(join(root, 'src/dash-scenes.js'), 'utf8');
  const walk = d => readdirSync(d).flatMap(n => statSync(join(d, n)).isDirectory() ? walk(join(d, n)).map(x => `${n}/${x}`) : [n]);
  assert.deepEqual(walk(join(root, 'public/media')).filter(f => !src.includes(`/media/${f}`)), []);
});

test('every <img> has alt, intrinsic size and an async decode hint (no layout shift)', () => {
  for (const tag of html.match(/<img [^>]*>/g)) { assert.match(tag, /\balt="/, tag); assert.match(tag, /\bwidth="\d+"/, tag); assert.match(tag, /\bheight="\d+"/, tag); assert.match(tag, /decoding="async"/, tag); }
});

test('raster images are WebP (the only JPEG is the og:image link preview)', () => {
  assert.deepEqual([...html.matchAll(/\/media\/[\w./-]+\.(png|jpe?g)/g)].map(m => m[0]).filter(f => f !== '/media/og.jpg'), []);
});

test('head basics: lang, title, description, viewport, theme colour, social preview', () => {
  assert.match(html, /<html lang="en">/); assert.match(html, /<title>[^<]{5,}<\/title>/);
  for (const m of ['name="description"', 'name="viewport"', 'name="theme-color"', 'property="og:title"', 'property="og:image"', 'name="twitter:card"']) assert.ok(html.includes(m), m);
});

test('exactly one h1 (the hero) and one h2 per remaining chapter', () => {
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.equal((html.match(/<h2[\s>]/g) ?? []).length, 6, 'chapters 02–07');
});

test('no inline event handlers or inline scripts (strict-CSP friendly)', () => {
  assert.doesNotMatch(html, /\son[a-z]+="/i); assert.deepEqual((html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? []), []);
});

test('server text goes in through textContent / el(): no innerHTML anywhere', () => {
  for (const f of ['src/main.js', 'src/dash-live.js']) assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, f);
});

test('interactive cards are keyboard reachable', () => { for (const tag of html.match(/<article class="card3d"[^>]*>/g)) assert.match(tag, /tabindex="0"/); });

test('external links that open a new tab are noopener', () => { for (const tag of html.match(/<a [^>]*target="_blank"[^>]*>/g) ?? []) assert.match(tag, /noopener/); });

test('class names do not collide with the page-level layout classes (.dot.top once picked up the sticky header)', () => {
  const css = readFileSync(join(root, 'src/style.css'), 'utf8'), layout = ['top', 'hero', 'ticker', 'nav', 'brand'];
  for (const c of layout) assert.doesNotMatch(html, new RegExp(`class="[^"]*\\bdot ${c}\\b`), `.dot.${c}`);
  assert.match(css, /\.top\{position:sticky/);
});

test('split hosts: the game link goes through GAME_BASE and nothing calls a bare /api path', () => {
  assert.match(main, /GAME_BASE/); assert.doesNotMatch(main, /\/play\.html'/, 'no hard-coded /play.html in a JS string');
  for (const f of ['src/main.js', 'src/dash-live.js']) assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /fetch\(|XMLHttpRequest/, `${f}: API calls go through client/site/wallet.js (API_BASE)`);
});
