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
  const js = files.filter(f => f.endsWith('.js'));
  for (const f of js) assert.ok(statSync(f).size <= 30 * KB, `${f} ${statSync(f).size} B > 30 kB`);
  assert.ok(js.reduce((a, f) => a + gz(f), 0) <= 44 * KB, 'all JS together ≤ 44 kB gzipped (incl. the lazy live-dash chunks)');   // 40 → 44 on Oct 11: the cab radio's eleven stations (client/js/sim/radio.js, ~5.7 kB gz) ride in the lazy dash chunk; the eager entry is unchanged
});

test('CSS ≤ 14 kB gzipped (landing + whitepaper), HTML ≤ 14 kB gzipped (landing) / ≤ 27 kB (the whitepaper, a long read)', { skip: !has }, () => {
  assert.ok(files.filter(f => f.endsWith('.css')).reduce((a, f) => a + gz(f), 0) <= 14 * KB);
  assert.ok(gz(join(dist, 'index.html')) <= 14 * KB);
  assert.ok(gz(join(dist, 'whitepaper.html')) <= 27 * KB);   // 26 → 27 on Oct 10 (the free levels, forks and the phone map)
});

test('media: no single image over 120 kB, all images together ≤ 600 kB; the lazy hero video ≤ 3 MB', { skip: !has }, () => {
  const media = files.filter(f => f.includes('/media/') && !f.endsWith('.mp4'));
  for (const f of files.filter(f => f.endsWith('.mp4'))) assert.ok(statSync(f).size <= 3 * 1024 * KB, `${f} ${statSync(f).size} B`);
  for (const f of media) assert.ok(statSync(f).size <= 120 * KB, `${f} ${statSync(f).size} B`);
  assert.ok(media.reduce((a, f) => a + statSync(f).size, 0) <= 600 * KB);
});

test('the live dash chunks are lazy: the entry bundle does not import the cockpit', { skip: !has }, () => {
  const entry = readFileSync(join(dist, 'index.html'), 'utf8').match(/src="(\/assets\/index-[\w-]+\.js)"/)?.[1];
  assert.ok(entry, 'entry script found'); const code = readFileSync(join(dist, entry), 'utf8');
  assert.doesNotMatch(code, /windscreen|ignitionPanel|drawCockpit/); assert.match(code, /dash-live/);
});

test('no three.js ends up in the landing', { skip: !has }, () => {
  for (const f of files.filter(f => f.endsWith('.js'))) assert.doesNotMatch(readFileSync(f, 'utf8'), /WebGLRenderer|THREE\./, f);
});
