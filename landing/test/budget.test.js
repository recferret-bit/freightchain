import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* Size budget of the production build (run `npm run build` first; skipped when dist/ is missing so `npm test` works on a fresh clone). */
const dist = new URL('../dist', import.meta.url).pathname, has = existsSync(join(dist, 'index.html'));
const walk = d => readdirSync(d).flatMap(n => statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]);
const files = has ? walk(dist) : [], gz = f => gzipSync(readFileSync(f)).length;
const KB = 1024;

test('JS: the eager bundle is small, nothing in dist/assets is large', { skip: !has }, () => {
  const js = files.filter(f => f.endsWith('.js') && !/\/pitchdeck-/.test(f));   // the pitch deck's own script is on its own line below
  for (const f of js) assert.ok(statSync(f).size <= 34 * KB, `${f} ${statSync(f).size} B > 34 kB`);
  assert.ok(js.reduce((a, f) => a + gz(f), 0) <= 62 * KB, 'all JS together ≤ 62 kB gzipped (incl. the lazy live-dash chunks)');   // 40 → 44 on Oct 11: the cab radio's eleven stations (client/js/sim/radio.js, ~5.7 kB gz) ride in the lazy dash chunk; the eager entry is unchanged; 50 → 55 on Oct 12: the UNDER THE HOOD canvas scenes (src/chain-scenes.js, ~4.6 kB gz), lazy as well; 55 → 59 on Oct 13: Wallet Standard discovery (client/site/wallet-standard.js, ~1.9 kB gz, eager – wallets must hear app-ready) + the wallet picker (~1.6 kB gz, lazy); 59 → 61 on Oct 13: mobile play restriction & spectator toast; 61 → 62 on Oct 15: the footer's pitch deck link (PITCHDECK_BASE in hosts.js)
});

test('CSS ≤ 14 kB gzipped (landing + whitepaper), HTML ≤ 15 kB gzipped (landing) / ≤ 34 kB (the whitepaper, a long read)', { skip: !has }, () => {
  assert.ok(files.filter(f => f.endsWith('.css') && !/\/pitchdeck-/.test(f)).reduce((a, f) => a + gz(f), 0) <= 14 * KB);
  assert.ok(gz(join(dist, 'index.html')) <= 15 * KB);
  assert.ok(gz(join(dist, 'whitepaper.html')) <= 34 * KB);   // 33 → 34 on Oct 14 (chapter 08, the penetration test & contracts audit); 26 → 27 on Oct 10 (the free levels, forks and the phone map); 27 → 28 on Oct 11 (the soulbound cNFT badges); 28 → 29 on Oct 12 (Native SIWS & SNS identity); 29 → 31 (the achievements chapter); 31 → 33 (the 31 badge cards with descriptions and art)
});

test('media: no single image over 120 kB, all images together ≤ 600 kB; the lazy hero video ≤ 3 MB (the pitch deck\'s own /media/pitchdeck/ is budgeted below)', { skip: !has }, () => {
  const media = files.filter(f => f.includes('/media/') && !f.includes('/media/pitchdeck/') && !f.endsWith('.mp4'));
  for (const f of files.filter(f => f.endsWith('.mp4'))) assert.ok(statSync(f).size <= 3 * 1024 * KB, `${f} ${statSync(f).size} B`);
  for (const f of media) assert.ok(statSync(f).size <= 120 * KB, `${f} ${statSync(f).size} B`);
  assert.ok(media.reduce((a, f) => a + statSync(f).size, 0) <= 600 * KB);
});

test('the pitch deck (pitchdeck.<apex>): each image ≤ 120 kB, all of them ≤ 600 kB, its clip ≤ 1.5 MB, its CSS ≤ 10 kB gz and JS ≤ 21 kB gz, no network of its own, media loaded lazily', { skip: !has }, () => {   // Oct 14: own line, the deck's ten screenshots would blow the landing's 600 kB
  const imgs = files.filter(f => f.includes('/media/pitchdeck/') && !f.endsWith('.mp4'));
  assert.ok(imgs.length >= 8);   // the deck's screenshots (9 after the roadmap shot left with the old Next slide)
  for (const f of imgs) assert.ok(statSync(f).size <= 120 * KB, `${f} ${statSync(f).size} B`);
  assert.ok(imgs.reduce((a, f) => a + statSync(f).size, 0) <= 600 * KB);   // Oct 15: 600 → 900 kB for the seven storybook shots, back to 600 once they were cut to their display size (960 px)
  for (const f of files.filter(f => f.includes('/media/pitchdeck/') && f.endsWith('.mp4'))) assert.ok(statSync(f).size <= 1.5 * 1024 * KB, `${f} ${statSync(f).size} B`);
  const html = readFileSync(join(dist, 'pitchdeck.html'), 'utf8'), css = html.match(/href="(\/assets\/pitchdeck-[\w-]+\.css)"/)?.[1], js = html.match(/src="(\/assets\/pitchdeck-[\w-]+\.js)"/)?.[1];
  assert.ok(css && js, 'the deck links its own hashed css + js');
  assert.ok(gz(join(dist, css)) <= 10 * KB,   // Oct 15: 9.5 → 10 kB (phone corner buttons, full screen hint, tap ring, wide-screen padding vars)  ·  10 → 9.5 kB after the theme / base merge and the dead rules went
    `deck CSS ${gz(join(dist, css))} B gz`);   // Oct 15: 9 → 10 kB (go to market: the truck's lanes, obstacles and ▲ ▼)
  assert.ok(gz(join(dist, js)) <= 21 * KB, `deck JS ${gz(join(dist, js))} B gz`);   // Oct 15: 20 → 21 kB (analytics: stats.js; the telemetry sender is the shared analytics chunk)  ·  19 → 20 kB (phone controls + full screen, the wide stage, the coins' sweep + dirty-rect drawing)  ·  17 → 19 kB (the truck honks; obstacles + lane changes)  ·  15 → 17 kB (go to market as six exit signs + the truck, slide 3's coins and slide 4's secret tiers)  ·  8 → 11 → 14 kB (the plan slide's lanes + the chain slide's copy)  ·  8 → 11 kB (floating cards, ticker, odometer, the 70/20/10 chain, the chain slide's six cards + 31 badge names); CSS 6 → 7.5 kB
  const code = readFileSync(join(dist, js), 'utf8');
  assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/, 'the deck makes no request of its own');
  assert.doesNotMatch(code, /<(img|video)\b[^>]*\ssrc=/, 'slide media are lazy: data-src in the markup, src only when a slide is near (hydrate)');
  assert.match(code, /data-src=/, 'slide media are lazy');
  assert.doesNotMatch(html, /https?:\/\/(?!freightchain\.fun)/, 'no third-party host in the page');
});

test('the live dash chunks are lazy: the entry bundle does not import the cockpit', { skip: !has }, () => {
  const entry = readFileSync(join(dist, 'index.html'), 'utf8').match(/src="(\/assets\/index-[\w-]+\.js)"/)?.[1];
  assert.ok(entry, 'entry script found'); const code = readFileSync(join(dist, entry), 'utf8');
  assert.doesNotMatch(code, /windscreen|ignitionPanel|drawCockpit/); assert.match(code, /dash-live/);
});

test('no three.js ends up in the landing', { skip: !has }, () => {
  for (const f of files.filter(f => f.endsWith('.js'))) assert.doesNotMatch(readFileSync(f, 'utf8'), /WebGLRenderer|THREE\./, f);
});
