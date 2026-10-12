import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Pledge } from '../../../src/domain/economy/pledge.entity.js';
import { computeBatchLeaf, computeTelemetryMerkleRoot, type DigestFn } from '../../../src/domain/telemetry/telemetry-merkle.js';
import { ConflictError, BadRequestError } from '../../../src/domain/shared/errors.js';

const sha256: DigestFn = (data) => createHash('sha256').update(data).digest();

/**
 * Official RFC 6962 / Google Certificate Transparency recursive reference implementation.
 * Section 2.1:
 * For n > 1, let k be the largest power of two smaller than n (k < n <= 2k).
 * MTH(D[n]) = SHA-256(0x01 || MTH(D[0:k]) || MTH(D[k:n]))
 */
function rfc6962ReferenceMth(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) return Buffer.alloc(32, 0); // Freight Chain domain sentinel
  if (leaves.length === 1) {
    return sha256(Buffer.concat([Buffer.from([0x00]), leaves[0]!]));
  }

  // DownToPowerOfTwo(n): largest power of 2 strictly less than n
  let split = 1;
  do {
    split <<= 1;
  } while (split < leaves.length);
  split >>= 1;

  const left = rfc6962ReferenceMth(leaves.slice(0, split));
  const right = rfc6962ReferenceMth(leaves.slice(split));
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

/**
 * On-chain Anchor Rust contract mathematical reference formula from pledge.rs:
 * let e = ((total_lamports as u128) * (effective_km as u128)) / (target_km as u128) as u64;
 * let r = total_lamports - e;
 */
function rustPledgeSettleReference(
  totalLamports: bigint,
  targetKm: number,
  verifiedKm: number,
  isFlagged: boolean,
): { earned: bigint; refund: bigint } {
  if (isFlagged) {
    return { earned: 0n, refund: totalLamports };
  }
  const vKm = BigInt(Math.max(0, verifiedKm));
  const tKm = BigInt(targetKm);
  const effectiveKm = vKm < tKm ? vKm : tKm;
  const e = (totalLamports * effectiveKm) / tKm;
  const r = totalLamports - e;
  return { earned: e, refund: r };
}

describe('Empirical Adversarial Verification: Milestone M3 Iteration 2', () => {
  const ID = '11111111-2222-4333-8444-555555555555';
  const PDA = 'PledgePda111111111111111111111111111111111';
  const SPONSOR = 'SponsorWallet111111111111111111111111111111';
  const DRIVER = 'DriverWallet111111111111111111111111111111';
  const NOW = new Date('2026-10-12T12:00:00Z');

  describe('1. Pledge.settle: Comprehensive Boundary km & Exact Lamport Conservation', () => {
    it('exhaustively satisfies lamport conservation across deterministic boundary conditions', () => {
      const targetDistances = [1, 2, 3, 5, 7, 10, 42, 100, 333, 1000, 999983];
      const rates = [1n, 3n, 7n, 100n, 1_000_000n, 1_000_000_000n, 10_000_000_000n];

      for (const targetKm of targetDistances) {
        for (const lamportsPerKm of rates) {
          const p = Pledge.create({
            id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1,
            lamportsPerKm, targetKm, now: NOW,
          });

          // Test boundary values: negative, zero, sub-target, exact target, above target
          const testKms = [
            -100, -1, 0,
            1,
            Math.floor(targetKm / 2),
            targetKm - 1,
            targetKm,
            targetKm + 1,
            targetKm * 2,
            targetKm * 10,
          ];

          for (const km of testKms) {
            for (const isFlagged of [false, true]) {
              const pClone = Pledge.restore(p.snapshot());
              const res = pClone.settle(km, isFlagged, NOW);

              // 1. Conservation Invariant: earned + refund === maxLamports
              expect(res.earnedLamports + res.refundedLamports).toBe(p.maxLamports);
              expect(res.earnedLamports).toBeGreaterThanOrEqual(0n);
              expect(res.refundedLamports).toBeGreaterThanOrEqual(0n);

              // 2. Parity with Solana on-chain Rust reference implementation
              const rustExpected = rustPledgeSettleReference(p.maxLamports, targetKm, km, isFlagged);
              expect(res.earnedLamports).toBe(rustExpected.earned);
              expect(res.refundedLamports).toBe(rustExpected.refund);

              // 3. Flagged semantics
              if (isFlagged) {
                expect(res.earnedLamports).toBe(0n);
                expect(res.refundedLamports).toBe(p.maxLamports);
              }

              // 4. Over-achievement clamping
              if (!isFlagged && km >= targetKm) {
                expect(res.earnedLamports).toBe(p.maxLamports);
                expect(res.refundedLamports).toBe(0n);
              }

              // 5. Zero / negative km clamping
              if (!isFlagged && km <= 0) {
                expect(res.earnedLamports).toBe(0n);
                expect(res.refundedLamports).toBe(p.maxLamports);
              }
            }
          }
        }
      }
    });

    it('property-based stress test: 5,000 randomized configurations preserve exact lamports', () => {
      let seed = 123456789;
      function pseudoRandom(): number {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      }

      for (let i = 0; i < 5000; i++) {
        const targetKm = Math.floor(pseudoRandom() * 5000) + 1;
        const rateVal = BigInt(Math.floor(pseudoRandom() * 10_000_000_000) + 1);
        const km = Math.floor(pseudoRandom() * 10000) - 100;
        const isFlagged = pseudoRandom() < 0.15;

        const pledge = Pledge.create({
          id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1,
          lamportsPerKm: rateVal, targetKm, now: NOW,
        });

        const outcome = pledge.settle(km, isFlagged, NOW);
        expect(outcome.earnedLamports + outcome.refundedLamports).toBe(pledge.maxLamports);

        const ref = rustPledgeSettleReference(pledge.maxLamports, targetKm, km, isFlagged);
        expect(outcome.earnedLamports).toBe(ref.earned);
        expect(outcome.refundedLamports).toBe(ref.refund);
      }
    });

    it('handles extreme integer boundaries up to i64::MAX without overflow or loss', () => {
      const maxI64 = 9_223_372_036_854_775_807n;
      const targetKm = 1_000_000;
      const rate = maxI64 / BigInt(targetKm);

      const pledge = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1,
        lamportsPerKm: rate, targetKm, now: NOW,
      });

      const res = pledge.settle(500_000, false, NOW);
      expect(res.earnedLamports + res.refundedLamports).toBe(pledge.maxLamports);
      expect(res.earnedLamports).toBe(pledge.maxLamports / 2n);
    });

    it('rejects duplicate settlement and invalid creation inputs', () => {
      const p = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1,
        lamportsPerKm: 1_000_000n, targetKm: 10, now: NOW,
      });
      p.settle(5, false, NOW);
      expect(() => p.settle(5, false, NOW)).toThrow(ConflictError);

      expect(() => Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: DRIVER, driver: DRIVER, poolId: 1,
        lamportsPerKm: 1_000_000n, targetKm: 10, now: NOW,
      })).toThrow(BadRequestError);
    });
  });

  describe('2. computeTelemetryMerkleRoot: RFC 6962 Certificate Transparency Compliance', () => {
    it('produces identical roots to the recursive RFC 6962 specification for all tree sizes 1..256', () => {
      for (let size = 1; size <= 256; size++) {
        const rawLeaves: Buffer[] = Array.from({ length: size }, (_, i) =>
          Buffer.from(`telemetry_batch_leaf_${i}_payload_data`),
        );

        const rfcRoot = rfc6962ReferenceMth(rawLeaves);
        const codeRoot = computeTelemetryMerkleRoot(rawLeaves, sha256);

        expect(codeRoot).toBeInstanceOf(Buffer);
        expect(codeRoot.length).toBe(32);
        expect(codeRoot.equals(rfcRoot)).toBe(true);
      }
    });

    it('validates RFC 6962 domain separation (0x00 leaf prefix vs 0x01 internal node prefix)', () => {
      const leaf0Raw = Buffer.from('leaf0');
      const leaf1Raw = Buffer.from('leaf1');

      const leaf0Hash = sha256(Buffer.concat([Buffer.from([0x00]), leaf0Raw]));
      const leaf1Hash = sha256(Buffer.concat([Buffer.from([0x00]), leaf1Raw]));

      // Single leaf is exactly leaf0Hash
      expect(computeTelemetryMerkleRoot([leaf0Raw], sha256).equals(leaf0Hash)).toBe(true);

      // Two leaves combine with 0x01 prefix
      const expectedPair = sha256(Buffer.concat([Buffer.from([0x01]), leaf0Hash, leaf1Hash]));
      expect(computeTelemetryMerkleRoot([leaf0Raw, leaf1Raw], sha256).equals(expectedPair)).toBe(true);

      // Verify that leaf prefix 0x00 prevents second preimage attack with internal nodes
      const fakeNodeData = Buffer.concat([leaf0Hash, leaf1Hash]);
      const fakeLeaf = computeBatchLeaf(fakeNodeData, sha256);
      expect(fakeLeaf.equals(expectedPair)).toBe(false);
    });

    it('correctly handles all TelemetryLeafInput formats (hex, Buffer, uint8, hash, body)', () => {
      const hexHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const bufData = Buffer.from('buffer_leaf');
      const uint8Data = new Uint8Array([10, 20, 30, 40]);
      const objHash = { hash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210' };
      const objBody = { body: { speed: 88, fuel: 95 } };

      const root = computeTelemetryMerkleRoot([hexHash, bufData, uint8Data, objHash, objBody], sha256);
      expect(root).toBeInstanceOf(Buffer);
      expect(root.length).toBe(32);
      expect(root.every((b) => b === 0)).toBe(false);
    });

    it('returns 32-byte zero buffer for empty batch array', () => {
      const root = computeTelemetryMerkleRoot([], sha256);
      expect(root.length).toBe(32);
      expect(root.every((b) => b === 0)).toBe(true);
    });
  });
});
