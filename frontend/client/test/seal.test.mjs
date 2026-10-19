import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkSeal, b58decode, pledgeEstimate, pledgeSol, poolAccountSeal, chainSealMismatch } from '../js/seal.js';
import { POOL_PROGRAM } from '../site/pools.js';

/* vectors made with the SERVER's packSeedPreimage + projectRoadSeed (server/src/domain/road/provable-seed.ts) and node:crypto SHA-256 – the second has
   two leading zero bytes in the slot hash ('11…' in base58) and a slot above 2^32 */
const V = [
  { poolId: 7, blockhash: 'BYM7KyebFXLLm82B3btLPZQ15mpQ4v6vAeyN6HzTYyKH', slot: 412345678, seedCommitment: 'YlFSe+I2X5qqNFO4P/GN4qEXuZeQfdGiFsDj15glG2I=', seed: 2068992354 },
  { poolId: 123, blockhash: '11L7PL6t3F69FvmnLauzEArngESMNUYDNc824z3aRHx', slot: 9007199254740, seedCommitment: 't9sJj1eea8bRsclgjq3bCtcfZs7gD7eNIHXQFH0Aoo8=', seed: 252304311 },
  /* written by the PROGRAM itself (LiteSVM; v4 seal_road at slot 1008): pool 0 of server/test/fixtures/chain/pool-program.json */
  { poolId: 0, blockhash: '5KovAGoer61Vvo1Uv7sod2PpdATt74wUm7ezjKsLpKeF', slot: 1008, seedCommitment: 'Ww4yfKeEqTMncAfIND0qsNIlR9WIfo6G4g1lPjO4dEU=', seed: 2083655259 },
];
/* the recorded Pool accounts (bytes as the RPC returns them) – the offsets poolAccountSeal reads */
const FIX = JSON.parse(fs.readFileSync(new URL('../../../backend/server/test/fixtures/chain/pool-program.json', import.meta.url), 'utf8'));
const pools = FIX.accounts.filter(a => a.decoded?.seedSlotHash).map(a => ({ data: Uint8Array.from(Buffer.from(a.data, 'base64')), d: a.decoded }));

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
test('pledge amounts keep the small digits', () => {
  assert.equal(pledgeSol('500000'), '0.0005 SOL');
  assert.equal(pledgeSol(2_000_000), '0.002 SOL');
  assert.equal(pledgeSol(0), '0 SOL');
  assert.equal(pledgeSol(1_500_000_000), '1.5 SOL');
});
test('the Pool account bytes carry the seal the codec decodes', () => {
  assert.ok(pools.length >= 3);
  for (const { data, d } of pools) {
    const a = poolAccountSeal(data);
    assert.equal(a.poolId, d.poolId);
    assert.equal(a.commitment, Buffer.from(d.seedCommitment, 'base64').toString('hex'));
    assert.equal(a.slotHash, Buffer.from(d.seedSlotHash, 'base64').toString('hex'));
    assert.equal(a.slot, Number(d.seedSlot));
  }
  assert.equal(poolAccountSeal(new Uint8Array(272)), null);   // not a Pool (discriminator)
  assert.equal(poolAccountSeal(pools[0].data.subarray(0, 100)), null);
});
test('the chain comparison: the right account passes, anything else says why', () => {
  const acc = pools.find(p => p.d.poolId === 0).data, ride = V[2];
  assert.equal(chainSealMismatch(ride, POOL_PROGRAM, POOL_PROGRAM, acc), '');
  assert.match(chainSealMismatch(ride, '11111111111111111111111111111111', POOL_PROGRAM, acc), /not the escrow program/);
  assert.match(chainSealMismatch({ ...ride, poolId: 4 }, POOL_PROGRAM, POOL_PROGRAM, acc), /another pool/);
  assert.match(chainSealMismatch({ ...ride, seedCommitment: V[0].seedCommitment }, POOL_PROGRAM, POOL_PROGRAM, acc), /another seal/);
  assert.match(chainSealMismatch({ ...ride, slot: 1 }, POOL_PROGRAM, POOL_PROGRAM, acc), /another seal/);
  assert.match(chainSealMismatch(ride, POOL_PROGRAM, POOL_PROGRAM, new Uint8Array(10)), /not a pool account/);
});
