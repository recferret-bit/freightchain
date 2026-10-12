/* On-chain proofs a TICKET ride can check in the browser – pure, no DOM (ui/cab-chain.js shows them; test/seal.test.mjs).
   The road seal: program v3 commits SHA-256(poolId u32 LE ‖ slot hash ‖ slot u64 LE) when the pool opens and keeps the slot and its hash beside it; the
   road seed is the commitment's first 4 bytes LE & 0x7fffffff (server/src/domain/road/provable-seed.ts, create_pool.rs seed_commitment_of). A ride
   carries all four (seedCommitment base64, blockhash base58, slot, seed), so the browser re-hashes the preimage and checks both. */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58decode(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('not base58'); n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c !== '1') break; out.unshift(0); }   // leading '1's are zero bytes
  return Uint8Array.from(out);
}
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = u => [...u].map(x => x.toString(16).padStart(2, '0')).join('');

/** → null (not a pool ride, or a pool from before the seal) or { ok, why, commitment (hex), slot } */
export async function checkSeal(ride) {
  if (!ride || ride.poolId == null || !ride.seedCommitment) return null;
  try {
    const commit = b64(ride.seedCommitment), bh = b58decode(ride.blockhash ?? '');
    if (commit.length !== 32 || bh.length !== 32) return { ok: false, why: 'malformed commitment', commitment: hex(commit), slot: ride.slot };
    const pre = new Uint8Array(44), v = new DataView(pre.buffer);
    v.setUint32(0, ride.poolId >>> 0, true); pre.set(bh, 4); v.setBigUint64(36, BigInt(ride.slot), true);
    const h = hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', pre)));
    const seed = (new DataView(commit.buffer).getUint32(0, true) & 0x7fff_ffff) >>> 0;
    const why = h !== hex(commit) ? 'the hash does not match' : seed !== ride.seed ? 'this road is not the committed seed' : '';
    return { ok: !why, why, commitment: hex(commit), slot: ride.slot };
  } catch (e) { return { ok: false, why: e.message, commitment: '', slot: ride.slot }; }
}

/* The Pool account as the program stores it (Anchor: 8-byte discriminator, then the fields in IDL order – server/src/infrastructure/solana/pool-program.idl.ts):
   pool_id u32 at 8 … seed_commitment [u8;32] at 200, seed_slot u64 at 232, seed_slot_hash [u8;32] at 240; 272 bytes. Checked on the recorded program
   fixture (server/test/fixtures/chain/pool-program.json) by test/seal.test.mjs. */
const POOL_DISC = [241, 154, 109, 4, 17, 177, 109, 188], POOL_LEN = 272;
/** the seal fields of a Pool account's data, or null when it is not one */
export function poolAccountSeal(data) {
  if (!(data instanceof Uint8Array) || data.length < POOL_LEN || POOL_DISC.some((b, i) => data[i] !== b)) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { poolId: v.getUint32(8, true), commitment: hex(data.subarray(200, 232)), slot: Number(v.getBigUint64(232, true)), slotHash: hex(data.subarray(240, 272)) };
}
/** does the account the CHAIN holds (`owner` = its program, `data` = its bytes) carry exactly this ride's seal? → '' or why not */
export function chainSealMismatch(ride, owner, program, data) {
  if (owner !== program) return 'the pool account is not the escrow program\'s';
  const a = poolAccountSeal(data);
  if (!a) return 'not a pool account';
  if (a.poolId !== ride.poolId) return 'another pool';
  if (a.commitment !== hex(b64(ride.seedCommitment)) || a.slot !== Number(ride.slot) || a.slotHash !== hex(b58decode(ride.blockhash ?? ''))) return 'the chain holds another seal';
  return '';
}
export const b64bytes = b64;

/** what a ride's pledges would pay at `metres` driven: rate × WHOLE km (the payout key attests whole km), each capped at its target km and its locked
    max. Active pledges only; the lamport fields are strings on the wire. An estimate: settle_pledge pays on the driver's BEST verified ride of the pool
    (one attestation per pool and driver – it can be another, longer ride), a FLAGGED one pays nothing, and only after the pool's review. */
export const pledgeEstimate = (pledges, metres) => pledges.filter(p => p.status === 'active')
  .reduce((a, p) => a + Math.min(Number(p.lamportsPerKm) * Math.min(Math.floor(metres / 1000), p.targetKm), Number(p.maxLamports)), 0);

/** a pledge amount, exact to the lamport-thousand: per-km rates are tiny (0.0005 SOL), so not pools.js `sol` (3 decimals) – the same as ui/watch-pledges.js */
export const pledgeSol = l => `${(Number(l) / 1e9).toFixed(Number(l) % 1e6 ? 6 : 3).replace(/0+$/, '').replace(/\.$/, '')} SOL`;
