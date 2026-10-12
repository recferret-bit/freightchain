import { describe, expect, it } from 'vitest';
import { Pledge } from '../../../../src/domain/economy/pledge.entity.js';
import { rideIdFromBytes, rideIdToBytes } from '../../../../src/domain/economy/pledge.types.js';
import { toPledgeDto } from '../../../../src/domain/economy/pledge.dto.js';
import { BadRequestError, ConflictError } from '../../../../src/domain/shared/errors.js';

describe('Pledge aggregate & ride ID codec', () => {
  const ID = '11111111-2222-4333-8444-555555555555';
  const PDA = 'PledgePda111111111111111111111111111111111';
  const SPONSOR = 'SponsorWallet111111111111111111111111111111';
  const DRIVER = 'DriverWallet111111111111111111111111111111';
  const NOW = new Date('2026-10-12T12:00:00Z');

  describe('Pledge.create validation', () => {
    it('creates a valid pledge and computes maxLamports = lamportsPerKm * targetKm', () => {
      const p = Pledge.create({
        id: ID,
        pdaAddress: PDA,
        rideId: ID,
        sponsor: SPONSOR,
        driver: DRIVER,
        poolId: 1,
        lamportsPerKm: 10_000_000n,
        targetKm: 50,
        now: NOW,
      });

      expect(p.id).toBe(ID);
      expect(p.pdaAddress).toBe(PDA);
      expect(p.rideId).toBe(ID);
      expect(p.sponsor).toBe(SPONSOR);
      expect(p.driver).toBe(DRIVER);
      expect(p.poolId).toBe(1);
      expect(p.lamportsPerKm).toBe(10_000_000n);
      expect(p.targetKm).toBe(50);
      expect(p.maxLamports).toBe(500_000_000n);
      expect(p.isSettled).toBe(false);
      expect(p.earnedLamports).toBe(0n);
      expect(p.refundedLamports).toBe(0n);
      expect(p.createdAt).toEqual(NOW);
      expect(p.settledAt).toBeNull();
    });

    it('refuses sponsor === driver', () => {
      expect(() => Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: SPONSOR, poolId: 1, lamportsPerKm: 1_000_000n, targetKm: 10, now: NOW,
      })).toThrow(BadRequestError);
    });

    it('refuses non-positive targetKm', () => {
      expect(() => Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1, lamportsPerKm: 1_000_000n, targetKm: 0, now: NOW,
      })).toThrow(BadRequestError);
      expect(() => Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1, lamportsPerKm: 1_000_000n, targetKm: -5, now: NOW,
      })).toThrow(BadRequestError);
    });

    it('refuses non-positive lamportsPerKm', () => {
      expect(() => Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1, lamportsPerKm: 0n, targetKm: 10, now: NOW,
      })).toThrow(BadRequestError);
    });
  });

  describe('Pledge.settle and mathematical conservation invariant', () => {
    it('settles proportionally when verifiedKm < targetKm: earned + refund === maxLamports', () => {
      const p = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1,
        lamportsPerKm: 10_000_000n, targetKm: 100, now: NOW,
      });

      const settleNow = new Date('2026-10-12T13:00:00Z');
      const { earnedLamports, refundedLamports } = p.settle(40, false, settleNow, 'sig123', 12345n);

      expect(earnedLamports).toBe(400_000_000n);
      expect(refundedLamports).toBe(600_000_000n);
      expect(earnedLamports + refundedLamports).toBe(p.maxLamports);
      expect(p.isSettled).toBe(true);
      expect(p.earnedLamports).toBe(400_000_000n);
      expect(p.refundedLamports).toBe(600_000_000n);
      expect(p.settledAt).toEqual(settleNow);
      expect(p.signature).toBe('sig123');
      expect(p.slot).toBe(12345n);
    });

    it('caps earned at maxLamports when verifiedKm >= targetKm: refund is 0', () => {
      const p = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1,
        lamportsPerKm: 5_000_000n, targetKm: 20, now: NOW,
      });

      const { earnedLamports, refundedLamports } = p.settle(25, false, NOW);
      expect(earnedLamports).toBe(100_000_000n);
      expect(refundedLamports).toBe(0n);
      expect(earnedLamports + refundedLamports).toBe(p.maxLamports);
    });

    it('allocates 100% refund and 0 earned when verifiedKm is 0', () => {
      const p = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1,
        lamportsPerKm: 5_000_000n, targetKm: 20, now: NOW,
      });

      const { earnedLamports, refundedLamports } = p.settle(0, false, NOW);
      expect(earnedLamports).toBe(0n);
      expect(refundedLamports).toBe(100_000_000n);
      expect(earnedLamports + refundedLamports).toBe(p.maxLamports);
    });

    it('allocates 100% refund and 0 earned when flagged, regardless of verifiedKm', () => {
      const p = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1,
        lamportsPerKm: 5_000_000n, targetKm: 20, now: NOW,
      });

      const { earnedLamports, refundedLamports } = p.settle(100, true, NOW);
      expect(earnedLamports).toBe(0n);
      expect(refundedLamports).toBe(100_000_000n);
      expect(earnedLamports + refundedLamports).toBe(p.maxLamports);
    });

    it('preserves exact lamport conservation with prime numbers / truncated integer divisions', () => {
      // 3 lamports per km, target 7 km -> maxLamports = 21
      const p = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1,
        lamportsPerKm: 3n, targetKm: 7, now: NOW,
      });

      // 2 km driven: earned = (21 * 2) / 7 = 6, refund = 15 -> 6 + 15 = 21
      const res = p.settle(2, false, NOW);
      expect(res.earnedLamports).toBe(6n);
      expect(res.refundedLamports).toBe(15n);
      expect(res.earnedLamports + res.refundedLamports).toBe(21n);
    });

    it('refuses double settlement', () => {
      const p = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1,
        lamportsPerKm: 1_000_000n, targetKm: 10, now: NOW,
      });

      p.settle(5, false, NOW);
      expect(() => p.settle(5, false, NOW)).toThrow(ConflictError);
    });

    it('maps to DTO correctly', () => {
      const p = Pledge.create({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1,
        lamportsPerKm: 10_000_000n, targetKm: 10, now: NOW,
      });
      p.settle(5, false, NOW, 'txSig', 999n);

      const dto = toPledgeDto(p);
      expect(dto).toEqual({
        id: ID,
        pdaAddress: PDA,
        rideId: ID,
        sponsor: SPONSOR,
        driver: DRIVER,
        poolId: 1,
        maxLamports: '100000000',
        lamportsPerKm: '10000000',
        targetKm: 10,
        settled: true,
        earnedLamports: '50000000',
        refundedLamports: '50000000',
        createdAt: NOW.getTime(),
        settledAt: NOW.getTime(),
        signature: 'txSig',
        slot: '999',
      });
    });
  });

  describe('rideIdToBytes and rideIdFromBytes reversibility', () => {
    it('converts canonical UUID to 32 bytes and back identically', () => {
      const uuid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
      const bytes32 = rideIdToBytes(uuid);

      expect(bytes32.length).toBe(32);
      // Bytes 16..32 must be 0
      expect(bytes32.slice(16).every((b) => b === 0)).toBe(true);

      const restored = rideIdFromBytes(bytes32);
      expect(restored).toBe(uuid);
    });

    it('rejects invalid inputs', () => {
      expect(() => rideIdToBytes('not-a-uuid')).toThrow(RangeError);
      expect(() => rideIdFromBytes(new Uint8Array(16))).toThrow(RangeError);
    });
  });
});
