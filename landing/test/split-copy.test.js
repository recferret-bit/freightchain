import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* The pool default is 65% prizes, 5% referrals, 20% seed, 10% fee. Fee stays 10%. The five points come off the prize pot. */
const root = new URL('..', import.meta.url).pathname;
const read = f => readFileSync(join(root, f), 'utf8');

test('the landing states 65/5/20/10, not 70/20/10', () => {
  const html = read('index.html');
  assert.match(html, /<u>65%<\/u> prizes · <u>5%<\/u> referrals · <u>20%<\/u> next pool · <u>10%<\/u> fees/);
  assert.match(html, /flex:65/); assert.match(html, /flex:5/); assert.match(html, /flex:20/); assert.match(html, /flex:10/);
  assert.match(html, /Prize 65%/); assert.match(html, /referrals 5%, seed 20%, fee 10%/); assert.match(html, />65\/5\/20\/10</);
  assert.doesNotMatch(html, /70\/20\/10|<u>70%<\/u>|Prize 70%/);
});

test('the whitepaper split sentence is 65/5/20/10, and it still says there is no referral token', () => {
  const html = read('whitepaper.html');
  assert.match(html, /65 % prizes · 5 % referrals · 20 % seeds the next pool · 10 % fees/);
  assert.match(html, /a referral token/);
  assert.doesNotMatch(html, /70 % prizes · 20 % seeds the next pool · 10 % fees/);
});

test('the pitch bar is four segments and the fact line matches', () => {
  const data = read('src/pitchdeck/data.js');
  assert.match(data, /65 percent prizes, 5 percent referrals, 20 percent to the next pool, 10 percent fee/);
  assert.deepEqual(data.match(/<div style="--w:\d+">/g), ['<div style="--w:65">', '<div style="--w:5">', '<div style="--w:20">', '<div style="--w:10">']);
  assert.match(data, />5%</); assert.match(data, /paid for invites/);
  assert.match(data, /Prize pool split 65 \/ 5 \/ 20 \/ 10/);
  assert.doesNotMatch(data, /70 \/ 20 \/ 10|--w:70/);
  assert.match(read('src/pitchdeck.css'), /\.split div:nth-child\(4\)/);
  assert.match(read('src/pitchdeck/stats.js'), /what=split|interact\('split'\)|65\/5\/20\/10/);
  assert.doesNotMatch(read('src/pitchdeck.js'), /what:\s*['"]65/);   // the event property stays split
});
