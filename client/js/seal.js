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

/** what a ride's pledges would pay at `metres` driven: rate × WHOLE km (the payout key attests whole km), each capped at its target km and its locked
    max. Active pledges only; the lamport fields are strings on the wire. An estimate – a pledge pays only once the ride is verified after the review. */
export const pledgeEstimate = (pledges, metres) => pledges.filter(p => p.status === 'active')
  .reduce((a, p) => a + Math.min(Number(p.lamportsPerKm) * Math.min(Math.floor(metres / 1000), p.targetKm), Number(p.maxLamports)), 0);

/** a pledge amount, exact to the lamport-thousand: per-km rates are tiny (0.0005 SOL), so not pools.js `sol` (3 decimals) – the same as ui/watch-pledges.js */
export const pledgeSol = l => `${(Number(l) / 1e9).toFixed(Number(l) % 1e6 ? 6 : 3).replace(/0+$/, '').replace(/\.$/, '')} SOL`;
