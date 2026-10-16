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

test('header shortcuts scroll through anchor.js (native smooth scroll lands short of the heading)', () => {
  assert.match(main, /bindAnchors\(\)/);
  assert.match(readFileSync(join(root, 'src/anchor.js'), 'utf8'), /contentVisibility = 'visible'/);
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
  const src = html + main + readFileSync(join(root, 'src/dash-scenes.js'), 'utf8') + readFileSync(join(root, 'whitepaper.html'), 'utf8') + readFileSync(join(root, 'pitchdeck.html'), 'utf8') + ['src/pitchdeck.js', ...readdirSync(join(root, 'src/pitchdeck')).map(f => `src/pitchdeck/${f}`)].map(f => readFileSync(join(root, f), 'utf8')).join('');   // the whitepaper reuses the dash card shots; the pitch deck reuses the hero clip and names its own /media/pitchdeck files
  const walk = d => readdirSync(d).flatMap(n => statSync(join(d, n)).isDirectory() ? walk(join(d, n)).map(x => `${n}/${x}`) : [n]);
  assert.deepEqual(walk(join(root, 'public/media')).filter(f => !src.includes(`/media/${f}`) && !(f.startsWith('pitchdeck/') && src.includes(f.slice('pitchdeck/'.length)))), []);   // the deck builds its paths from A = '/media/pitchdeck/'
});

test('every <img> has alt and an intrinsic size; every image but the LCP hero still decodes async', () => {
  const tags = html.match(/<img [^>]*>/g);
  for (const tag of tags) {
    assert.match(tag, /\balt="/, tag); assert.match(tag, /\bwidth="\d+"/, tag); assert.match(tag, /\bheight="\d+"/, tag);
    if (/fetchpriority="high"/.test(tag)) assert.doesNotMatch(tag, /decoding=/, `${tag}: the LCP image is not decoding=async`);
    else assert.match(tag, /decoding="async"/, tag);
  }
  assert.equal(tags.filter(t => /fetchpriority="high"/.test(t)).length, 1);
});

test('raster images are WebP (the only JPEG is the og:image link preview)', () => {
  assert.deepEqual([...html.matchAll(/\/media\/[\w./-]+\.(png|jpe?g)/g)].map(m => m[0]).filter(f => f !== '/media/og.jpg'), []);
});

test('head basics: lang, title, description, viewport, theme colour, social preview', () => {
  assert.match(html, /<html lang="en">/); assert.match(html, /<title>[^<]{5,}<\/title>/);
  for (const m of ['name="description"', 'name="viewport"', 'name="theme-color"', 'property="og:title"', 'property="og:image"', 'name="twitter:card"']) assert.ok(html.includes(m), m);
});

test('exactly one h1 (the hero), one h2 for the pitch-deck band, the promo band, and each chapter 02–07 (no level skipped before chapter 02)', () => {
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.equal((html.match(/<h2[\s>]/g) ?? []).length, 8, 'the pitch-deck band + the promo band + chapters 02–07');
  assert.doesNotMatch(html.slice(0, html.indexOf('<h2')), /<h3[\s>]/, 'no h3 before the first h2');
});

test('no inline event handlers or inline scripts (strict-CSP friendly; JSON-LD is data, never run)', () => {
  assert.doesNotMatch(html, /\son[a-z]+="/i); assert.deepEqual((html.match(/<script(?![^>]*\b(?:src=|type="application\/ld\+json"))[^>]*>/g) ?? []), []);
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
  assert.match(main, /PITCHDECK_BASE/); assert.match(html, /id="pitchdeck-link"/, 'footer links to the pitch deck');
  assert.match(html, /id="pitchdeck-band" href="https:\/\/pitchdeck\.freightchain\.fun\/"/, 'the band under the hero links the pitch deck');
  assert.match(main, /for \(const id of \['pitchdeck-band', 'pitchdeck-link'\]\)/);
  assert.match(main, /GAME_BASE/); assert.doesNotMatch(main, /\/play\.html'/, 'no hard-coded /play.html in a JS string');
  for (const f of ['src/main.js', 'src/dash-live.js']) assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /fetch\(|XMLHttpRequest/, `${f}: API calls go through client/site/wallet.js (API_BASE)`);
});

test('hero video is off the critical path: no src, no autoplay, preload none, loaded after `load` when idle', () => {
  const tag = html.match(/<video id="hero-video"[^>]*>/)[0];
  assert.match(tag, /data-src="\/media\/hero-preview\.mp4"/); assert.match(tag, /preload="none"/); assert.doesNotMatch(tag, /\ssrc=|autoplay|poster=/);
  assert.match(main, /requestIdleCallback/); assert.match(main, /addEventListener\('load'/); assert.match(main, /saveData/);
  assert.doesNotMatch(main, /max-width:\s*700px/, 'a phone plays the hero loop too (the stills read as a frozen video)');
  assert.match(main, /heroVideo\.playsInline = true/, 'iOS needs playsInline set before src');
  assert.equal((main.match(/heroVideo\.src = /g) ?? []).length, 1, 'the src is assigned in exactly one place (loadHeroVideo)');
  const slides = html.match(/<div class="slides" id="slides">([\s\S]*?)<\/div>/)[1];
  assert.equal((slides.match(/<img\b/g) ?? []).length, 1, 'only the day still is in the hero; the other two load if the video will not play');
  assert.match(main, /\/media\/hero-poster\.webp/); assert.match(main, /\/media\/night\.webp/);
  assert.match(html, /<div id="demo-frame">/); assert.doesNotMatch(html, /<iframe|<video id="demo/, 'the demo player is created on click, never in the markup'); assert.doesNotMatch(main, /youtube-nocookie|\/embed\//, 'no third-party embed in the demo dialog');
  const css = readFileSync(join(root, 'src/style.css'), 'utf8');
  assert.match(css, /translateX\(var\(--shift,-50%\)\)/, 'the ticker distance is a measured length, not a % of the screen');
  assert.match(css, /@media \(hover:hover\)\{\.ticker:hover \.tk\{animation-play-state:paused\}\}/);
  assert.match(main, /--shift/);
});

test('sign-in: redirect + session UI go through SITE_BASE, the wallet chip exists, errors are shown not thrown', () => {
  assert.match(main, /SITE_BASE\}\/lobby\.html/); assert.doesNotMatch(main, /href = '\/lobby\.html'/);
  assert.ok(ids.includes('chip-wallet')); assert.match(main, /api\('me', undefined, \{ report: false \}\)[\s\S]{0,500}?paintSession/);
  assert.match(main, /catch \(e\) \{ msg\.textContent = e\.message; msg\.className = 'msg bad'; btn\.disabled = false; \}/);
});

test('promo invite: a form in its own band right after the hero (an <aside>, not a chapter – no nav link, its own h2), the code rides to the lobby PROMO tab through SITE_BASE, shown with textContent only', () => {
  for (const id of ['invite', 'invite-code', 'invite-go', 'invite-msg']) assert.ok(ids.includes(id), id);
  assert.match(html, /<form class="invite[^"]*" id="invite"/);
  assert.match(html, /<\/section>\s*<div class="road"[\s\S]*?<\/div>\s*<!--[^>]*PITCH DECK[^>]*-->\s*<aside class="deck-band"[\s\S]*?<\/aside>\s*<div class="road"[\s\S]*?<\/div>\s*<!--[^>]*PROMO CODE[^>]*-->\s*<aside class="promo-band" id="promo-band"[\s\S]*?<form class="invite[\s\S]*?<\/aside>\s*<div class="road"/, 'a road, the pitch-deck invite, a road, then the promo band, sit between the hero and the road to chapter 02');
  assert.match(main, /new URLSearchParams\(location\.search\)\.get\('promo'\)/, 'an invite link: /?promo=CODE pre-fills the field');
  assert.match(main, /\$\{SITE_BASE\}\/lobby\.html\$\{code \? `\?promo=\$\{encodeURIComponent\(code\)\}#promo` : ''\}/, 'the lobby is opened on #promo with the code, url-encoded');
  assert.match(main, /const code = inviteIn\.value\.trim\(\) \|\| invite;/, 'a code typed but not submitted survives CONNECT');
  assert.match(main, /const CODE_SHAPE = \/\^\[A-Z0-9_-\]\{3,32\}\$\//, 'only a code-shaped string is tracked');
  assert.match(main, /\$\('invite'\)\.onsubmit/);
  assert.match(main, /track\('promo_invite_viewed'/); assert.match(main, /track\('promo_invite_submitted'/);   // the funnel's first two steps (docs/analytics, funnel 9)
  assert.match(main, /reportWebVitals\('landing'\)/);
  assert.doesNotMatch(main, /inviteMsg\.(innerHTML|insertAdjacentHTML)/);
});

test('the lobby has no PROMO tab (the codes are in the PROFILE) and takes the invite code only as a pre-fill', () => {
  const lobbyHtml = readFileSync(join(root, '..', 'client', 'lobby.html'), 'utf8'), lobby = readFileSync(join(root, '..', 'client', 'site', 'lobby.js'), 'utf8');
  assert.doesNotMatch(lobbyHtml, /data-tab="promo"/);
  assert.match(lobbyHtml, /<a role="tab" href="#achievements" data-tab="achievements">ACHIEVEMENTS<\/a>/);
  assert.match(lobby, /const TABS = \['new', 'live', 'replays', 'board', 'achievements', 'garage', 'profile'\]/);
  assert.match(lobbyHtml, /<a role="tab" href="#garage" data-tab="garage">GARAGE<\/a>/);
  assert.match(lobby, /api\('garage\/loadout'/); assert.match(lobby, /track\('garage_part_clicked'/);
  assert.match(lobby, /reportWebVitals\('lobby'\)/);
  assert.match(lobby, /new URLSearchParams\(location\.search\)\.get\('promo'\)/);
  assert.doesNotMatch(lobby, /get\('promo'\)[\s\S]{0,200}api\('promo\/redeem'/, 'a link never redeems by itself');
});

test('the icons the pages name exist (what Phantom, tabs and home screens show for the site)', () => {
  const client = join(root, '..', 'client');
  for (const page of [join(root, 'index.html'), join(client, 'lobby.html'), join(client, 'play.html'), join(client, 'viewer.html')]) {
    const links = [...readFileSync(page, 'utf8').matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="(\/[^"]+)"/g)].map(m => m[1]);
    assert.ok(links.length >= 4, `${page}: icon links`);
    assert.deepEqual(links.filter(l => !existsSync(join(client, l))), [], page);
  }
  const manifest = JSON.parse(readFileSync(join(client, 'manifest.webmanifest'), 'utf8'));
  assert.deepEqual(manifest.icons.map(i => i.src).filter(l => !existsSync(join(client, l))), []);
  assert.ok(manifest.icons.some(i => i.sizes === '192x192') && manifest.icons.some(i => i.sizes === '512x512'));
});

test('faq: ten questions in the html, every card starts closed, the chevron is not a control', () => {
  const block = html.slice(html.indexOf('id="faq"'), html.indexOf('</section>', html.indexOf('id="faq"')));
  const q = [...block.matchAll(/<button type="button"[^>]*>([^<]+)<\/button>/g)].map(m => m[1]);
  assert.deepEqual(q, [
    'Can I play without a crypto wallet?',
    'Is Freight Chain free?',
    'Do I have to buy a token, an NFT, or any crypto to try it?',
    'Is there a Freight Chain token?',
    'What can I win, and is that money real today?',
    'Who holds the entry fees, and what if a pool does not fill?',
    'How long is a shift, and what ends it?',
    'Can I watch without playing or signing in?',
    'Do I install anything?',
    'Is this play-to-earn?',
  ]);
  assert.equal((block.match(/class="fq on"/g) ?? []).length, 0);
  assert.equal((block.match(/aria-expanded="false"/g) ?? []).length, 10);
  assert.deepEqual([...block.matchAll(/data-item="([^"]+)"/g)].map(m => m[1]), ['wallet', 'free', 'buy', 'token', 'prize', 'vault', 'shift', 'watch', 'install', 'earn']);
  assert.equal((block.match(/<i class="chev" aria-hidden="true">/g) ?? []).length, 10);
  assert.doesNotMatch(block, /<details|<summary/);
  assert.match(main, /faq_item_opened/);
  assert.match(main, /closest\('a, \.chev'\)/);
  assert.match(block, /There is no token/); assert.match(block, /nothing on it is real money/); assert.match(block, /about 100 km\/h/);
});

test('pools: the live board + the escrow block exist, the explainer is the whitepaper chapter, the pool wording is the lobby\'s', () => {
  assert.ok(ids.includes('pools') && ids.includes('escrow-link'));
  assert.match(main, /\$\('escrow-link'\)\.href = escrowExplainer\(\)/, 'the escrow link goes to the whitepaper chapter 05');
  assert.match(main, /from '\.\.\/\.\.\/client\/site\/pools\.js'/);
  assert.match(html, /id="escrow-link" href="https:\/\/whitepaper\.freightchain\.fun\/#onchain"/, "static fallback before the script runs");
  assert.equal(existsSync(join(root, '..', 'client', 'escrow')), false, 'no standalone /escrow/ page');
  assert.doesNotMatch(main, /class: `st /, 'the pool chip is .pst – .st is the roadmap\'s rubber stamp');
});
