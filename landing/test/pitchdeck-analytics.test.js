import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');

test('the pitch deck has its own web manifest: a home-screen shortcut opens the deck, not the lobby', () => {
  assert.match(read('pitchdeck.html'), /<link rel="manifest" href="\/media\/pitchdeck\/pitchdeck\.webmanifest">/);
  const m = JSON.parse(read('public/media/pitchdeck/pitchdeck.webmanifest'));
  assert.equal(m.scope, '/');
  assert.ok(m.start_url.startsWith('/?') && !m.start_url.includes('lobby'));
  assert.equal(m.display, 'standalone');
});

test('every pitch deck analytics event is on the server allowlist, with the properties it sends', () => {
  const ts = read('../server/src/domain/analytics/client-events.ts');
  const sent = [...(read('src/pitchdeck/stats.js') + read('src/main.js')).matchAll(/track\('(pitchdeck_[a-z_]+)', \{([^}]*)\}/g)];
  assert.ok(sent.length >= 4);
  for (const [, name, body] of sent) {
    assert.ok(ts.includes(`'${name}',`), `${name} is in CLIENT_EVENTS`);
    const allow = ts.match(new RegExp(`${name}: \\[([^\\]]*)\\]`))?.[1] ?? '';
    for (const seg of body.split(',')) { const key = seg.match(/^\s*([a-z_]+)\s*(:|$)/)?.[1]; if (key) assert.ok(allow.includes(`'${key}'`), `${name}.${key} is allowed`); }
  }
});

test('the deck sends anonymously (no session cookie) and reports its web vitals', () => {
  const stats = read('src/pitchdeck/stats.js');
  assert.match(stats, /configure\(\{ credentials: 'omit' \}\)/);
  assert.match(stats, /reportWebVitals\('pitchdeck'\)/);
  assert.match(read('../client/js/web-vitals.js'), /new Set\(\['landing', 'whitepaper', 'lobby', 'pitchdeck'\]\)/);
});
