import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeTrafficProof, decodeTrafficProof } from '../shared/traffic-proof.js';
test('traffic proof preserves floating-point state exactly and stays below the HTTP body budget', () => {
  const rows = Array.from({ length: 500 }, (_, i) => [1 / 60, i / 60, Math.sin(i) * 20, 2.4, -.0001, Math.PI, 22, 22, 99.9, 0, 1, 99.9]);
  const encoded = encodeTrafficProof(rows);
  assert.deepEqual(decodeTrafficProof(encoded), rows);
  assert.equal(encoded.length, 64_000);
});
test('malformed, oversized and partial traffic frames are refused', () => {
  for (const input of ['?', 'AAA=', 'a'.repeat(85_004), '===', 'AA==']) assert.equal(decodeTrafficProof(input), null);
  assert.deepEqual(decodeTrafficProof(''), []);
});
