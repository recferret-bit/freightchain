import assert from 'node:assert/strict';
import test from 'node:test';
import { qrModules, qrSvg } from '../site/qr.js';

const finder = (rows, r0, c0) => {
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    const edge = r === 0 || c === 0 || r === 6 || c === 6;
    const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
    const on = rows[r0 + r][c0 + c];
    if (edge || core) { if (!on) return false; }
    else if (on) return false;
  }
  return true;
};

test('qr is a square with three finders and a quiet zone', () => {
  const text = 'solana:https%3A%2F%2Fapi.freightchain.fun%2Fapi%2Fsolana-pay%2Frides%2F1';
  const a = qrModules(text);
  const b = qrModules(text);
  assert.deepEqual(a, b);
  assert.equal(a.length, a[0].length);
  assert.ok(a.length >= 21 + 8);
  assert.equal(a[0].some(Boolean), false); // quiet zone
  assert.equal(finder(a, 4, 4), true);
  assert.equal(finder(a, 4, a.length - 4 - 7), true);
  assert.equal(finder(a, a.length - 4 - 7, 4), true);
  assert.notDeepEqual(qrModules(text + 'x'), a);
});

test('qr svg is self contained', () => {
  const svg = qrSvg('https://freightchain.fun');
  assert.match(svg, /<svg/);
  assert.doesNotMatch(svg, /<img|href="https?:/i);
});
