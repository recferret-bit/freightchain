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
  const src = html + main + readFileSync(join(root, 'src/dash-scenes.js'), 'utf8') + readFileSync(join(root, 'whitepaper.html'), 'utf8');   // the whitepaper reuses the dash card shots
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
  assert.match(main, /STORYBOOK_BASE/); assert.match(html, /id="storybook-link"/, 'footer links to the model viewer');
  assert.match(main, /WHITEPAPER_BASE/); assert.match(html, /id="whitepaper-link"/, 'footer links to the whitepaper');
  assert.match(main, /GAME_BASE/); assert.doesNotMatch(main, /\/play\.html'/, 'no hard-coded /play.html in a JS string');
  for (const f of ['src/main.js', 'src/dash-live.js']) assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /fetch\(|XMLHttpRequest/, `${f}: API calls go through client/site/wallet.js (API_BASE)`);
});

test('hero video is off the critical path: no src, no autoplay, preload none, loaded after `load` when idle', () => {
  const tag = html.match(/<video id="hero-video"[^>]*>/)[0];
  assert.match(tag, /data-src="\/media\/hero-preview\.mp4"/); assert.match(tag, /preload="none"/); assert.doesNotMatch(tag, /\ssrc=|autoplay|poster=/);
  assert.match(main, /requestIdleCallback/); assert.match(main, /addEventListener\('load'/); assert.match(main, /saveData/);
  assert.equal((main.match(/heroVideo\.src = /g) ?? []).length, 1, 'the src is assigned in exactly one place (loadHeroVideo)');
  assert.match(html.match(/<video id="demo-video"[^>]*>/)[0], /preload="none"/);
});

test('sign-in: redirect + session UI go through SITE_BASE, the wallet chip exists, errors are shown not thrown', () => {
  assert.match(main, /SITE_BASE\}\/lobby\.html/); assert.doesNotMatch(main, /href = '\/lobby\.html'/);
  assert.ok(ids.includes('chip-wallet')); assert.match(main, /api\('me', undefined, \{ report: false \}\)[\s\S]{0,500}?paintSession/);
  assert.match(main, /catch \(e\) \{ msg\.textContent = e\.message; msg\.className = 'msg bad'; btn\.disabled = false; \}/);
});

test('promo invite: a form in its own band right after the hero (an <aside>, not a chapter – no nav link, no h2), the code rides to the lobby PROMO tab through SITE_BASE, shown with textContent only', () => {
  for (const id of ['invite', 'invite-code', 'invite-go', 'invite-msg']) assert.ok(ids.includes(id), id);
  assert.match(html, /<form class="invite[^"]*" id="invite"/);
  assert.match(html, /<\/section>\s*<!--[^>]*PROMO CODE[^>]*-->\s*<aside class="promo-band" id="promo-band"[\s\S]*?<form class="invite[\s\S]*?<\/aside>\s*<div class="road"/, 'the band sits between the hero and the road to chapter 02');
  assert.match(main, /new URLSearchParams\(location\.search\)\.get\('promo'\)/, 'an invite link: /?promo=CODE pre-fills the field');
  assert.match(main, /\$\{SITE_BASE\}\/lobby\.html\$\{code \? `\?promo=\$\{encodeURIComponent\(code\)\}#promo` : ''\}/, 'the lobby is opened on #promo with the code, url-encoded');
  assert.match(main, /const code = inviteIn\.value\.trim\(\) \|\| invite;/, 'a code typed but not submitted survives CONNECT');
  assert.match(main, /const CODE_SHAPE = \/\^\[A-Z0-9_-\]\{3,32\}\$\//, 'only a code-shaped string is tracked');
  assert.match(main, /\$\('invite'\)\.onsubmit/);
  assert.match(main, /track\('promo_invite_viewed'/); assert.match(main, /track\('promo_invite_submitted'/);   // the funnel's first two steps (docs/analytics, funnel 9)
  assert.doesNotMatch(main, /inviteMsg\.(innerHTML|insertAdjacentHTML)/);
});

test('the lobby has the PROMO tab and takes the invite code only as a pre-fill', () => {
  const lobbyHtml = readFileSync(join(root, '..', 'client', 'lobby.html'), 'utf8'), lobby = readFileSync(join(root, '..', 'client', 'site', 'lobby.js'), 'utf8');
  assert.match(lobbyHtml, /<a role="tab" href="#promo" data-tab="promo">PROMO<\/a>/);
  assert.match(lobby, /const TABS = \['new', 'live', 'replays', 'board', 'garage', 'promo', 'profile'\]/);
  assert.match(lobbyHtml, /<a role="tab" href="#garage" data-tab="garage">GARAGE<\/a>/);
  assert.match(lobby, /api\('garage\/loadout'/); assert.match(lobby, /track\('garage_part_clicked'/);
  assert.match(lobby, /new URLSearchParams\(location\.search\)\.get\('promo'\)/);
  assert.doesNotMatch(lobby, /get\('promo'\)[\s\S]{0,200}api\('promo\/redeem'/, 'a link never redeems by itself');
});

test('the icons the pages name exist (what Phantom, tabs and home screens show for the site)', () => {
  const client = join(root, '..', 'client');
  for (const page of [join(root, 'index.html'), join(client, 'lobby.html'), join(client, 'play.html'), join(client, 'viewer.html'), join(client, 'escrow', 'index.html')]) {
    const links = [...readFileSync(page, 'utf8').matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="(\/[^"]+)"/g)].map(m => m[1]);
    assert.ok(links.length >= 4, `${page}: icon links`);
    assert.deepEqual(links.filter(l => !existsSync(join(client, l))), [], page);
  }
  const manifest = JSON.parse(readFileSync(join(client, 'manifest.webmanifest'), 'utf8'));
  assert.deepEqual(manifest.icons.map(i => i.src).filter(l => !existsSync(join(client, l))), []);
  assert.ok(manifest.icons.some(i => i.sizes === '192x192') && manifest.icons.some(i => i.sizes === '512x512'));
});

test('pools: the live board + the escrow block exist, the explainer is linked through SITE_BASE, the pool wording is the lobby\'s', () => {
  assert.ok(ids.includes('pools') && ids.includes('escrow-link'));
  assert.match(main, /\$\('escrow-link'\)\.href = `\$\{SITE_BASE\}\$\{ESCROW_PAGE\}`/);
  assert.match(main, /from '\.\.\/\.\.\/client\/site\/pools\.js'/);
  assert.match(html, /href="\/escrow\/"/, 'static fallback before the script runs');
  assert.ok(existsSync(join(root, '..', 'client', 'escrow', 'index.html')), 'the explainer is served from client/escrow/');
  assert.doesNotMatch(main, /class: `st /, 'the pool chip is .pst – .st is the roadmap\'s rubber stamp');
});
