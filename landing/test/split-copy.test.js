import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* Program v5 pool default is 85% prizes, 5% next pool (rollover), 10% Season Final / fees (8500/500/1000 bps, player share < 50%). */
const root = new URL('..', import.meta.url).pathname;
const read = f => readFileSync(join(root, f), 'utf8');

test('the landing states 85/5/10, not 65/5/20/10 or 70/20/10', () => {
  const html = read('index.html');
  assert.match(html, /<u>85%<\/u> prizes · <u>5%<\/u> next pool · <u>10%<\/u> season final/);
  assert.match(html, /flex:85/); assert.match(html, /flex:5/); assert.match(html, /flex:10/);
  assert.match(html, /85% weekly boards[\s\S]*5% rollover, 10% Season Final/); assert.match(html, />85\/5\/10</);
  assert.doesNotMatch(html, /65\/5\/20\/10|70\/20\/10|<u>65%<\/u>|<u>70%<\/u>|Prize 65%|Prize 70%/);
});

test('the whitepaper split sentence is 85/5/10, and it still says there is no referral token', () => {
  const html = read('whitepaper.html');
  assert.match(html, /85 % prizes · 5 % seeds the next pool · 10 % fees/);
  assert.match(html, /a referral token/);
  assert.doesNotMatch(html, /65 % prizes · 5 % referrals · 20 % seeds the next pool · 10 % fees|70 % prizes · 20 % seeds the next pool · 10 % fees/);
});

test('the pitch bar is three segments (85/5/10) and the fact line matches', () => {
  const data = read('src/pitchdeck/data.js');
  assert.match(data, /85 percent prizes, 5 percent to the next pool, 10 percent Season Final and fee/);
  assert.deepEqual(data.match(/<div style="--w:\d+">/g), ['<div style="--w:85">', '<div style="--w:5">', '<div style="--w:10">']);
  assert.match(data, />85%</); assert.match(data, />5%</); assert.match(data, />10%</);
  assert.match(data, /Prize pool split 85 \/ 5 \/ 10/);
  assert.doesNotMatch(data, /65 \/ 5 \/ 20 \/ 10|70 \/ 20 \/ 10|--w:65|--w:70/);
  assert.match(read('src/pitchdeck.css'), /\.split div:nth-child\(3\)/);
  assert.doesNotMatch(read('src/pitchdeck.css'), /\.split div:nth-child\(4\)/);
  assert.match(read('src/pitchdeck/stats.js'), /what=split|interact\('split'\)|85\/5\/10/);
  assert.doesNotMatch(read('src/pitchdeck.js'), /what:\s*['"](?:65|85)/);   // the event property stays split
});
