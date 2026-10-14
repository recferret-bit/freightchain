import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_WINNERS, rootFromProof, winnerLeaf, winnersTree } from '../../../src/domain/economy/winners-merkle.js';
import { poolProgramFixture } from '../../support/chain-fixtures.js';

const sha = (d: Uint8Array | Buffer) => createHash('sha256').update(d).digest();
const b64 = (b: Buffer) => b.toString('base64');

describe('winners root (program v4 commit_winners / pay_prize proofs)', () => {
  it('reproduces the program\'s roots and proofs byte for byte for 1, 2, 3 and 20 winners (export_fixtures.rs winner_vectors)', () => {
    const vectors = (poolProgramFixture() as unknown as { winners: { poolId: number; list: { wallet: string; lamports: string }[]; root: string; total: string; proofs: string[][] }[] }).winners;
    expect(vectors.map((v) => v.list.length)).toEqual([1, 2, 3, 20]);
    for (const v of vectors) {
      const t = winnersTree(v.poolId, v.list.map((w) => ({ wallet: w.wallet, lamports: Number(w.lamports) })), sha);
      expect(b64(t.root)).toBe(v.root);
      expect(String(t.total)).toBe(v.total);
      expect(t.proofs.map((p) => p.map(b64))).toEqual(v.proofs);
      v.list.forEach((w, i) => {   // and every proof leads back to the root, as the program checks it (merkle_root_from)
        const leaf = winnerLeaf(v.poolId, i, { wallet: w.wallet, lamports: Number(w.lamports) }, sha);
        expect(rootFromProof(leaf, i, v.list.length, t.proofs[i]!, sha)).toEqual(t.root);
        expect(rootFromProof(leaf, i, v.list.length, [...t.proofs[i]!, Buffer.alloc(32)], sha)).toBeNull();
      });
    }
  });

  it('no winner = the zero root (count 0), and more than 64 is refused', () => {
    expect(winnersTree(1, [], sha)).toEqual({ root: Buffer.alloc(32), total: 0, proofs: [] });
    const many = Array.from({ length: MAX_WINNERS + 1 }, () => ({ wallet: '11111111111111111111111111111111', lamports: 1 }));
    expect(() => winnersTree(1, many, sha)).toThrow(RangeError);
  });

  it('the root binds the pool, the rank, the wallet and the amount', () => {
    const w = [{ wallet: 'GMiqWjvJeR51tS9m65CqtAG8ajqhDiLUiQTpyg9DmjYn', lamports: 5 }, { wallet: '6zoY5fDG2RxPUCC8ds2pCaQS9ZpgpncHmqRsNGyZUtds', lamports: 3 }];
    const r = (p: number, l: typeof w) => b64(winnersTree(p, l, sha).root);
    expect(new Set([r(1, w), r(2, w), r(1, [w[1]!, w[0]!]), r(1, [{ ...w[0]!, lamports: 6 }, w[1]!])]).size).toBe(4);
  });
});
