import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSeal, b58decode, pledgeEstimate } from '../js/seal.js';

/* vectors made with the SERVER's packSeedPreimage + projectRoadSeed (server/src/domain/road/provable-seed.ts) and node:crypto SHA-256 – the second has
   two leading zero bytes in the slot hash ('11…' in base58) and a slot above 2^32 */
const V = [
  { poolId: 7, blockhash: 'BYM7KyebFXLLm82B3btLPZQ15mpQ4v6vAeyN6HzTYyKH', slot: 412345678, seedCommitment: 'YlFSe+I2X5qqNFO4P/GN4qEXuZeQfdGiFsDj15glG2I=', seed: 2068992354 },
  { poolId: 123, blockhash: '11L7PL6t3F69FvmnLauzEArngESMNUYDNc824z3aRHx', slot: 9007199254740, seedCommitment: 't9sJj1eea8bRsclgjq3bCtcfZs7gD7eNIHXQFH0Aoo8=', seed: 252304311 },
];

test('the server\'s seals check out in the browser code', async () => {
  for (const v of V) { const s = await checkSeal(v); assert.equal(s.ok, true, s.why); assert.equal(s.commitment.length, 64); }
});
test('a wrong seed, slot, pool or hash is caught', async () => {
  const v = V[0];
  assert.match((await checkSeal({ ...v, seed: v.seed + 1 })).why, /not the committed seed/);
  assert.match((await checkSeal({ ...v, slot: v.slot + 1 })).why, /hash does not match/);
  assert.match((await checkSeal({ ...v, poolId: 8 })).why, /hash does not match/);
  assert.equal((await checkSeal({ ...v, blockhash: 'not-base58!' })).ok, false);
});
test('no pool or no commitment = nothing to show', async () => {
  assert.equal(await checkSeal(null), null);
  assert.equal(await checkSeal({ ...V[0], poolId: null }), null);
  assert.equal(await checkSeal({ ...V[0], seedCommitment: null }), null);
});
test('base58: leading 1s are zero bytes', () => {
  assert.deepEqual([...b58decode('11L7PL6t3F69FvmnLauzEArngESMNUYDNc824z3aRHx').slice(0, 3)], [0, 0, 0x5f]);
  assert.equal(b58decode('BYM7KyebFXLLm82B3btLPZQ15mpQ4v6vAeyN6HzTYyKH').length, 32);
});
test('pledge estimate: whole km, capped by target and max, active only', () => {
  const p = (lamportsPerKm, targetKm, maxLamports, status = 'active') => ({ lamportsPerKm: String(lamportsPerKm), targetKm, maxLamports: String(maxLamports), status });
  assert.equal(pledgeEstimate([p(1000, 50, 50000)], 12_999), 12_000);
  assert.equal(pledgeEstimate([p(1000, 10, 50000)], 30_000), 10_000);
  assert.equal(pledgeEstimate([p(1000, 50, 5000)], 30_000), 5000);
  assert.equal(pledgeEstimate([p(1000, 50, 50000), p(500, 50, 50000, 'pending'), p(2000, 5, 10000)], 7_400), 7000 + 10000);
});
