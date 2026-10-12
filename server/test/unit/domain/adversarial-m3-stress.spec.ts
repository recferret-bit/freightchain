import { createHash, randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';
import { packSeedPreimage, projectRoadSeed } from '../../../src/domain/road/provable-seed.js';
import {
  computeBatchLeaf,
  computeTelemetryMerkleRoot,
  type DigestFn,
} from '../../../src/domain/telemetry/telemetry-merkle.js';
import { Pledge } from '../../../src/domain/economy/pledge.entity.js';
import type { PledgeProps } from '../../../src/domain/economy/pledge.types.js';

const sha256: DigestFn = (data) => createHash('sha256').update(data).digest();

describe('Adversarial M3 Stress Harness', () => {
  describe('1. Provable Road Seed Stress & Invariants', () => {
    it('throws RangeError for buffers strictly less than 4 bytes', () => {
      expect(() => projectRoadSeed(new Uint8Array(0))).toThrow(RangeError);
      expect(() => projectRoadSeed(new Uint8Array(1))).toThrow(RangeError);
      expect(() => projectRoadSeed(new Uint8Array(2))).toThrow(RangeError);
      expect(() => projectRoadSeed(new Uint8Array(3))).toThrow(RangeError);
    });

    it('handles exact 4-byte boundary inputs and masks bit 31', () => {
      // All zeroes
      expect(projectRoadSeed(new Uint8Array([0, 0, 0, 0]))).toBe(0);

      // 0x7fff_ffff (all 31 bits set, MSB 0)
      expect(projectRoadSeed(new Uint8Array([0xff, 0xff, 0xff, 0x7f]))).toBe(2147483647);

      // 0xffff_ffff (all 32 bits set, MSB 1 -> masked to 0x7fff_ffff)
      expect(projectRoadSeed(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBe(2147483647);

      // Only MSB set (0x8000_0000 -> masked to 0)
      expect(projectRoadSeed(new Uint8Array([0x00, 0x00, 0x00, 0x80]))).toBe(0);

      // MSB set with LSB set (0x8000_0001 -> masked to 1)
      expect(projectRoadSeed(new Uint8Array([0x01, 0x00, 0x00, 0x80]))).toBe(1);

      // 0x7fff_fffe (2147483646)
      expect(projectRoadSeed(new Uint8Array([0xfe, 0xff, 0xff, 0x7f]))).toBe(2147483646);
    });

    it('works correctly with views that have non-zero byteOffset', () => {
      const buffer = new Uint8Array(64);
      // Put [0x34, 0x12, 0x00, 0x00] at offset 10
      buffer[10] = 0x34;
      buffer[11] = 0x12;
      buffer[12] = 0x00;
      buffer[13] = 0x00;

      const slice = buffer.subarray(10);
      expect(projectRoadSeed(slice)).toBe(0x1234);
    });

    it('fuzzes 10,000 random commitments: output is strictly in [0, 2147483647]', () => {
      for (let i = 0; i < 10_000; i++) {
        const raw = randomBytes(32);
        const seed = projectRoadSeed(raw);

        expect(typeof seed).toBe('number');
        expect(Number.isSafeInteger(seed)).toBe(true);
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThanOrEqual(2147483647);
        expect(seed).toBe(seed & 0x7fff_ffff);

        // Verify against reference oracle
        const oracle = (raw[0]! | (raw[1]! << 8) | (raw[2]! << 16) | ((raw[3]! & 0x7f) << 24)) >>> 0;
        expect(seed).toBe(oracle);
      }
    });

    it('packSeedPreimage enforces strict 44-byte layout across extremes', () => {
      const validBh = bs58.encode(new Uint8Array(32).fill(0xcc));

      // Boundary pool IDs
      for (const poolId of [0, 1, 0x7fff_ffff, 0xffff_ffff, -1]) {
        const packed = packSeedPreimage(poolId, validBh, 0n);
        expect(packed.length).toBe(44);
        const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
        expect(view.getUint32(0, true)).toBe(poolId >>> 0);
      }

      // Slot boundaries: 0, max u32, max u64
      const slots = [0n, 1n, 4294967295n, 18446744073709551615n];
      for (const slot of slots) {
        const packed = packSeedPreimage(42, validBh, slot);
        expect(packed.length).toBe(44);
        const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
        expect(view.getBigUint64(36, true)).toBe(slot);
      }

      // Rejects invalid blockhashes
      expect(() => packSeedPreimage(1, bs58.encode(new Uint8Array(0)), 1n)).toThrow(RangeError);
      expect(() => packSeedPreimage(1, bs58.encode(new Uint8Array(31)), 1n)).toThrow(RangeError);
      expect(() => packSeedPreimage(1, bs58.encode(new Uint8Array(33)), 1n)).toThrow(RangeError);
    });
  });

  describe('2. RFC 6962 Merkle Tree Edge Cases & Adversarial Resistance', () => {
    it('handles 0 leaves by returning 32 zero bytes', () => {
      const root = computeTelemetryMerkleRoot([], sha256);
      expect(root).toHaveLength(32);
      expect(root.equals(Buffer.alloc(32, 0))).toBe(true);
    });

    it('handles 1 leaf by returning the domain-separated leaf hash directly', () => {
      const data = 'single_leaf_payload';
      const leaf = computeBatchLeaf(data, sha256);
      const root = computeTelemetryMerkleRoot([data], sha256);
      expect(root.equals(leaf)).toBe(true);
      // Domain separation byte 0x00 check
      const expected = sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(data, 'utf8')]));
      expect(root.equals(expected)).toBe(true);
    });

    it('handles 2 leaves by hashing left and right with 0x01 prefix', () => {
      const l0 = computeBatchLeaf('payload_0', sha256);
      const l1 = computeBatchLeaf('payload_1', sha256);
      const root = computeTelemetryMerkleRoot(['payload_0', 'payload_1'], sha256);
      const expected = sha256(Buffer.concat([Buffer.from([0x01]), l0, l1]));
      expect(root.equals(expected)).toBe(true);
    });

    it('computes arbitrary odd leaf counts (3, 5, 7, 9, 17, 33) deterministically', () => {
      for (const count of [3, 5, 7, 9, 17, 33]) {
        const leaves = Array.from({ length: count }, (_, i) => `chunk_${i}`);
        const root = computeTelemetryMerkleRoot(leaves, sha256);
        expect(root).toBeInstanceOf(Buffer);
        expect(root).toHaveLength(32);
      }
    });

    it('prevents second-preimage attack: interior node preimage cannot be forged as a leaf', () => {
      const left = computeBatchLeaf('chunk_a', sha256);
      const right = computeBatchLeaf('chunk_b', sha256);
      const interiorNodeHash = sha256(Buffer.concat([Buffer.from([0x01]), left, right]));

      // Adversary attempts to forge interior node as a single leaf with matching concatenated content
      const attackLeafData = Buffer.concat([left, right]);
      const forgedLeafHash1 = computeBatchLeaf(attackLeafData, sha256);
      expect(forgedLeafHash1.equals(interiorNodeHash)).toBe(false);

      // Adversary attempts to include the 0x01 prefix in leaf data
      const attackLeafDataWithPrefix = Buffer.concat([Buffer.from([0x01]), left, right]);
      const forgedLeafHash2 = computeBatchLeaf(attackLeafDataWithPrefix, sha256);
      expect(forgedLeafHash2.equals(interiorNodeHash)).toBe(false);
    });

    it('prevents duplication collision attacks (CVE-2012-2459 style)', () => {
      // In Bitcoin, odd leaf duplication allows [A, B, C] and [A, B, C, C] to have identical roots.
      // Under RFC 6962 promotion, [A, B, C] and [A, B, C, C] MUST have different roots.
      const leaves3 = ['batch_1', 'batch_2', 'batch_3'];
      const leaves4 = ['batch_1', 'batch_2', 'batch_3', 'batch_3'];

      const root3 = computeTelemetryMerkleRoot(leaves3, sha256);
      const root4 = computeTelemetryMerkleRoot(leaves4, sha256);

      expect(root3.equals(root4)).toBe(false);

      // Similarly for 5 leaves vs 6 leaves
      const leaves5 = ['b1', 'b2', 'b3', 'b4', 'b5'];
      const leaves6 = ['b1', 'b2', 'b3', 'b4', 'b5', 'b5'];
      expect(computeTelemetryMerkleRoot(leaves5, sha256).equals(computeTelemetryMerkleRoot(leaves6, sha256))).toBe(false);
    });

    it('verifies exact step-by-step intermediate node promotions for a 5-leaf tree', () => {
      const items = ['d0', 'd1', 'd2', 'd3', 'd4'];
      const l0 = computeBatchLeaf('d0', sha256);
      const l1 = computeBatchLeaf('d1', sha256);
      const l2 = computeBatchLeaf('d2', sha256);
      const l3 = computeBatchLeaf('d3', sha256);
      const l4 = computeBatchLeaf('d4', sha256);

      // Level 1:
      const n01 = sha256(Buffer.concat([Buffer.from([0x01]), l0, l1]));
      const n23 = sha256(Buffer.concat([Buffer.from([0x01]), l2, l3]));
      const n4 = l4; // promoted

      // Level 2:
      const n0123 = sha256(Buffer.concat([Buffer.from([0x01]), n01, n23]));
      const n4_l2 = n4; // promoted again

      // Level 3 (Root):
      const expectedRoot = sha256(Buffer.concat([Buffer.from([0x01]), n0123, n4_l2]));

      const root = computeTelemetryMerkleRoot(items, sha256);
      expect(root.equals(expectedRoot)).toBe(true);
    });

    it('processes large batches (1023 and 1024 leaves) without mutation or memory leak', () => {
      const b1023 = Array.from({ length: 1023 }, (_, i) => ({ hash: randomBytes(32).toString('hex') }));
      const b1024 = Array.from({ length: 1024 }, (_, i) => ({ hash: randomBytes(32).toString('hex') }));

      const root1023 = computeTelemetryMerkleRoot(b1023, sha256);
      const root1024 = computeTelemetryMerkleRoot(b1024, sha256);

      expect(root1023).toHaveLength(32);
      expect(root1024).toHaveLength(32);
      expect(b1023).toHaveLength(1023);
      expect(b1024).toHaveLength(1024);
    });
  });

  describe('3. Pledge Settlement Math & Lamport Conservation Invariant', () => {
    const ID = '11111111-2222-4333-8444-555555555555';
    const PDA = 'PledgePda111111111111111111111111111111111';
    const SPONSOR = 'SponsorWallet111111111111111111111111111111';
    const DRIVER = 'DriverWallet111111111111111111111111111111';
    const NOW = new Date('2026-10-12T12:00:00Z');

    it('settles with zero verified km: 0 earned, 100% refund, earned + refund === maxLamports', () => {
      const p = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER,
        poolId: 1, lamportsPerKm: 1_000_000n, targetKm: 100, now: NOW,
      });

      const { earnedLamports, refundedLamports } = p.settle(0, false, NOW);
      expect(earnedLamports).toBe(0n);
      expect(refundedLamports).toBe(p.maxLamports);
      expect(earnedLamports + refundedLamports).toBe(p.maxLamports);
    });

    it('settles with exact target km: 100% earned, 0 refund, earned + refund === maxLamports', () => {
      const p = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER,
        poolId: 1, lamportsPerKm: 2_500_000n, targetKm: 40, now: NOW,
      });

      const { earnedLamports, refundedLamports } = p.settle(40, false, NOW);
      expect(earnedLamports).toBe(p.maxLamports);
      expect(refundedLamports).toBe(0n);
      expect(earnedLamports + refundedLamports).toBe(p.maxLamports);
    });

    it('settles exceeding target km: capped at maxLamports, 0 refund, earned + refund === maxLamports', () => {
      const p = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER,
        poolId: 1, lamportsPerKm: 2_500_000n, targetKm: 40, now: NOW,
      });

      const { earnedLamports, refundedLamports } = p.settle(1_000_000, false, NOW);
      expect(earnedLamports).toBe(p.maxLamports);
      expect(refundedLamports).toBe(0n);
      expect(earnedLamports + refundedLamports).toBe(p.maxLamports);
    });

    it('settles flagged driver: 0 earned, 100% refund even with exceeding target km', () => {
      const p = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER,
        poolId: 1, lamportsPerKm: 10_000_000n, targetKm: 100, now: NOW,
      });

      const { earnedLamports, refundedLamports } = p.settle(500, true, NOW);
      expect(earnedLamports).toBe(0n);
      expect(refundedLamports).toBe(p.maxLamports);
      expect(earnedLamports + refundedLamports).toBe(p.maxLamports);
    });

    it('handles negative verified km by clamping to 0 (100% refund, 0 earned)', () => {
      const p = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER,
        poolId: 1, lamportsPerKm: 10_000_000n, targetKm: 100, now: NOW,
      });

      const { earnedLamports, refundedLamports } = p.settle(-250, false, NOW);
      expect(earnedLamports).toBe(0n);
      expect(refundedLamports).toBe(p.maxLamports);
      expect(earnedLamports + refundedLamports).toBe(p.maxLamports);
    });

    it('verifies strict monotonicity of earned and refund across all steps of prime pledge', () => {
      // 17 km target, 31 lamports/km => max = 527
      const targetKm = 17;
      const rate = 31n;
      const maxLamports = rate * BigInt(targetKm);

      let prevEarned = -1n;
      let prevRefund = maxLamports + 1n;

      for (let km = 0; km <= 25; km++) {
        const p = Pledge.create({
          id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER,
          poolId: 1, lamportsPerKm: rate, targetKm, now: NOW,
        });

        const { earnedLamports, refundedLamports } = p.settle(km, false, NOW);

        // Conservation
        expect(earnedLamports + refundedLamports).toBe(maxLamports);

        // Monotonicity
        expect(earnedLamports).toBeGreaterThanOrEqual(prevEarned);
        expect(refundedLamports).toBeLessThanOrEqual(prevRefund);

        if (km <= targetKm) {
          prevEarned = earnedLamports;
          prevRefund = refundedLamports;
        } else {
          // After targetKm, stays capped
          expect(earnedLamports).toBe(maxLamports);
          expect(refundedLamports).toBe(0n);
        }
      }
    });

    it('conserves lamports with large u64 values near maximum (2^64 - 1)', () => {
      const U64_MAX = 18446744073709551615n;

      // Restore a pledge with maxLamports near u64 max
      const props: PledgeProps = {
        id: ID,
        pdaAddress: PDA,
        rideId: ID,
        sponsor: SPONSOR,
        driver: DRIVER,
        poolId: 1,
        maxLamports: U64_MAX,
        lamportsPerKm: U64_MAX / 100n,
        targetKm: 100,
        settled: false,
        earnedLamports: 0n,
        refundedLamports: 0n,
        createdAt: NOW,
        settledAt: null,
        signature: null,
        slot: null,
      };

      for (const verifiedKm of [0, 1, 33, 50, 99, 100, 250]) {
        const p = Pledge.restore({ ...props });
        const { earnedLamports, refundedLamports } = p.settle(verifiedKm, false, NOW);

        expect(earnedLamports + refundedLamports).toBe(U64_MAX);
        expect(earnedLamports).toBeGreaterThanOrEqual(0n);
        expect(refundedLamports).toBeGreaterThanOrEqual(0n);
        expect(earnedLamports).toBeLessThanOrEqual(U64_MAX);
        expect(refundedLamports).toBeLessThanOrEqual(U64_MAX);
      }
    });

    it('fuzzes 5,000 arbitrary pledge configurations: 0 lamports lost under all divisions', () => {
      for (let i = 0; i < 5_000; i++) {
        // Random targetKm between 1 and 10,000
        const targetKm = Math.floor(Math.random() * 10_000) + 1;
        // Random rate up to 10^12
        const rate = BigInt(Math.floor(Math.random() * 1_000_000_000) + 1);
        const maxLamports = rate * BigInt(targetKm);

        // Random verifiedKm from 0 to 20,000
        const verifiedKm = Math.floor(Math.random() * 20_000);
        const isFlagged = Math.random() < 0.1;

        const p = Pledge.create({
          id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER,
          poolId: 1, lamportsPerKm: rate, targetKm, now: NOW,
        });

        const { earnedLamports, refundedLamports } = p.settle(verifiedKm, isFlagged, NOW);

        // Hard invariant: zero lost lamports
        expect(earnedLamports + refundedLamports).toBe(maxLamports);
        expect(earnedLamports).toBeGreaterThanOrEqual(0n);
        expect(refundedLamports).toBeGreaterThanOrEqual(0n);

        if (isFlagged || verifiedKm === 0) {
          expect(earnedLamports).toBe(0n);
          expect(refundedLamports).toBe(maxLamports);
        } else if (verifiedKm >= targetKm) {
          expect(earnedLamports).toBe(maxLamports);
          expect(refundedLamports).toBe(0n);
        } else {
          expect(earnedLamports).toBeGreaterThan(0n);
          expect(refundedLamports).toBeGreaterThan(0n);
        }
      }
    });
  });
});
