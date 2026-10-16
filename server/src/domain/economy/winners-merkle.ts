import bs58 from 'bs58';
import type { DigestFn } from '../telemetry/telemetry-merkle.js';

/** One rank of a pool's committed winners: rank = its index in the list. */
export interface WinnerLeaf {
  wallet: string;
  lamports: number;
}

export interface WinnersTree {
  /** 32 zero bytes for no winner (the program's `count = 0` commit) */
  root: Buffer;
  total: number;
  /** proofs[rank]: the sibling hashes bottom-up – `pay_prize`'s `proof` */
  proofs: Buffer[][];
}

/** the program's WINNER_LEAF_TAG (programs/freightchain-pools … constants.rs) */
const LEAF_TAG = new TextEncoder().encode('fc-winner');
/** `Pool.paid_mask` is a u64 */
export const MAX_WINNERS = 64;

const u32le = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64le = (n: number): Buffer => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

/** SHA-256(0x00 ‖ "fc-winner" ‖ pool_id LE u32 ‖ rank u8 ‖ wallet ‖ lamports LE u64) – state.rs `winner_leaf`, byte for byte. */
export function winnerLeaf(poolId: number, rank: number, w: WinnerLeaf, digest: DigestFn): Buffer {
  return digest(Buffer.concat([Buffer.from([0x00]), LEAF_TAG, u32le(poolId), Buffer.from([rank]), Buffer.from(bs58.decode(w.wallet)), u64le(w.lamports)]));
}

/**
 * A pool's winners root (audit H5-B, program v4 `commit_winners`): RFC 6962 node tag 0x01, an odd last node promoted (the shape of telemetry-merkle.ts and of
 * the program's `merkle_root_from`), and each rank's proof. The program checks a proof against the committed count, so no direction bits are needed.
 */
export function winnersTree(poolId: number, list: readonly WinnerLeaf[], digest: DigestFn): WinnersTree {
  if (list.length > MAX_WINNERS) throw new RangeError(`at most ${MAX_WINNERS} winners per root (got ${list.length})`);
  const total = list.reduce((a, w) => a + w.lamports, 0);
  if (!list.length) return { root: Buffer.alloc(32), total: 0, proofs: [] };
  const levels: Buffer[][] = [list.map((w, i) => winnerLeaf(poolId, i, w, digest))];
  for (let l = levels[0]!; l.length > 1; l = levels[levels.length - 1]!) {
    const next: Buffer[] = [];
    for (let i = 0; i < l.length; i += 2) next.push(i + 1 < l.length ? digest(Buffer.concat([Buffer.from([0x01]), l[i]!, l[i + 1]!])) : l[i]!);
    levels.push(next);
  }
  const proofs = list.map((_, rank) => {
    const proof: Buffer[] = [];
    let idx = rank;
    for (const l of levels.slice(0, -1)) {
      if ((idx ^ 1) < l.length) proof.push(l[idx ^ 1]!);
      idx >>= 1;
    }
    return proof;
  });
  return { root: levels[levels.length - 1]![0]!, total, proofs };
}

/** The root a proof leads to from leaf `index` of a `count`-leaf tree – state.rs `merkle_root_from` (null = an unusable proof: wrong length, index out of range). */
export function rootFromProof(leaf: Buffer, index: number, count: number, proof: readonly Uint8Array[], digest: DigestFn): Buffer | null {
  if (count === 0 || index >= count) return null;
  let [node, idx, width, used] = [leaf, index, count, 0];
  while (width > 1) {
    if (!(idx === width - 1 && width % 2 === 1)) {
      const sib = proof[used++];
      if (!sib) return null;
      node = digest(Buffer.concat([Buffer.from([0x01]), idx % 2 === 0 ? node : Buffer.from(sib), idx % 2 === 0 ? Buffer.from(sib) : node]));
    }
    idx >>= 1;
    width = Math.ceil(width / 2);
  }
  return used === proof.length ? node : null;
}
