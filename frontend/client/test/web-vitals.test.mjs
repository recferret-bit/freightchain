// The scoring half of js/web-vitals.js. The observers run in a browser; these pin the numbers the relay will see.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clsScore, inpScore, vitalRating } from '../js/web-vitals.js';

const shift = (t, v, input = false) => ({ t, v, input });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('a value on the CrUX edge is still good, and the next millisecond is not', () => {
  assert.equal(vitalRating('LCP', 2500), 'good');
  assert.equal(vitalRating('LCP', 2501), 'needs-improvement');
  assert.equal(vitalRating('LCP', 4000), 'needs-improvement');
  assert.equal(vitalRating('LCP', 4001), 'poor');
  assert.equal(vitalRating('INP', 200), 'good');
  assert.equal(vitalRating('INP', 501), 'poor');
  assert.equal(vitalRating('CLS', 0.1), 'good');
  assert.equal(vitalRating('CLS', 0.25), 'needs-improvement');
  assert.equal(vitalRating('CLS', 0.2501), 'poor');
  assert.equal(vitalRating('FCP', 1800), 'good');
  assert.equal(vitalRating('FCP', 3001), 'poor');
  assert.equal(vitalRating('TTFB', 800), 'good');
  assert.equal(vitalRating('TTFB', 1801), 'poor');
  assert.equal(vitalRating('nope', 1), null);
});

test('CLS adds a burst, ignores input shifts, and starts over after a 1 s gap or a 5 s window', () => {
  assert.equal(clsScore([]), 0);
  close(clsScore([shift(0, 0.05), shift(100, 0.06)]), 0.11);
  close(clsScore([shift(0, 0.05), shift(100, 0.2, true), shift(200, 0.01)]), 0.06);
  close(clsScore([shift(0, 0.2), shift(1000, 0.05)]), 0.2);
  const burst = [0, 900, 1800, 2700, 3600, 4500].map(t => shift(t, 0.01));
  close(clsScore(burst), 0.06);
  close(clsScore([...burst, shift(5400, 0.3)]), 0.3);   // 5400 is past 5 s from the first, so it is its own window
});

test('INP is the worst interaction under 50, then the second worst', () => {
  assert.equal(inpScore([]), null);
  assert.equal(inpScore([40]), 40);
  assert.equal(inpScore([10, 80, 20]), 80);
  assert.equal(inpScore(Array.from({ length: 50 }, (_, i) => i + 1)), 49);
});
