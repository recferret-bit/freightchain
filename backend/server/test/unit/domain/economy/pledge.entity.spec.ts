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
      expect(p.status).toBe('pending');
      expect(p.createSignature).toBeNull();
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

  describe('Pledge.apply – the row follows the program\'s events', () => {
    const POOL = 'PoolPda1111111111111111111111111111111111111';
    const make = (lamportsPerKm = 10_000_000n, targetKm = 100) => Pledge.create({ id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1, lamportsPerKm, targetKm, now: NOW });
    const base = { rideId: ID, sponsor: SPONSOR, driver: DRIVER, pool: POOL, slot: 7 };
    const created = (p: Pledge, signature = 'sigCreate') => ({ ...base, signature, kind: 'PledgeCreated' as const, maxLamports: p.maxLamports, lamportsPerKm: p.lamportsPerKm, targetKm: p.targetKm });
    const settled = (earned: bigint, refunded: bigint, signature = 'sigSettle') => ({ ...base, signature, kind: 'PledgeSettled' as const, verifiedKm: 40, earnedLamports: earned, refundedLamports: refunded });
    const refunded = (lamports: bigint, signature = 'sigRefund') => ({ ...base, signature, kind: 'PledgeRefunded' as const, refundedLamports: lamports });
    const LATER = new Date('2026-10-12T13:00:00Z');

    it('starts pending; PledgeCreated with the same terms makes it active once (idempotent)', () => {
      const p = make();
      expect(p.status).toBe('pending');
      expect(p.apply(created(p), NOW)).toBe(true);
      expect(p.status).toBe('active');
      expect(p.createSignature).toBe('sigCreate');
      expect(p.apply(created(p, 'other'), NOW)).toBe(false);
      expect(p.createSignature).toBe('sigCreate');
    });

    it('refuses a PledgeCreated with other terms, and an event of another pledge', () => {
      const p = make();
      expect(() => p.apply({ ...created(p), targetKm: 99 }, NOW)).toThrow(ConflictError);
      expect(() => p.apply({ ...created(p), maxLamports: p.maxLamports + 1n }, NOW)).toThrow(ConflictError);
      expect(() => p.apply({ ...created(p), sponsor: 'Someone' }, NOW)).toThrow(ConflictError);
      expect(p.status).toBe('pending');
    });

    it('PledgeSettled records what the program paid: earned + refunded must equal the cap', () => {
      const p = make();
      p.apply(created(p), NOW);
      expect(() => p.apply(settled(400_000_000n, 600_000_001n), LATER)).toThrow(RangeError);
      expect(p.apply(settled(400_000_000n, 600_000_000n), LATER)).toBe(true);
      expect(p.status).toBe('settled');
      expect(p.isSettled).toBe(true);
      expect(p.earnedLamports).toBe(400_000_000n);
      expect(p.refundedLamports).toBe(600_000_000n);
      expect(p.settledAt).toEqual(LATER);
      expect(p.signature).toBe('sigSettle');
      expect(p.slot).toBe(7n);
      expect(p.apply(refunded(p.maxLamports), LATER)).toBe(false); // a settled pledge stays settled
    });

    it('PledgeRefunded gives the whole cap back; a pledge first seen at its refund (create missed) still ends refunded', () => {
      const p = make(3n, 7);
      expect(() => p.apply(refunded(20n), LATER)).toThrow(RangeError);
      expect(p.apply(refunded(21n), LATER)).toBe(true);
      expect(p.status).toBe('refunded');
      expect(p.earnedLamports).toBe(0n);
      expect(p.refundedLamports).toBe(21n);
    });

    it('abandon: only a pending pledge; an abandoned one comes back if its create shows up after all', () => {
      const p = make();
      p.abandon();
      expect(p.status).toBe('abandoned');
      expect(p.apply(created(p), NOW)).toBe(true);
      expect(p.status).toBe('active');
      p.abandon();
      expect(p.status).toBe('active');
    });

    it('maps to the DTO', () => {
      const p = make(10_000_000n, 10);
      p.apply(created(p), NOW);
      p.apply(settled(50_000_000n, 50_000_000n, 'txSig'), NOW);
      expect(toPledgeDto(p)).toEqual({
        id: ID, pdaAddress: PDA, rideId: ID, sponsor: SPONSOR, driver: DRIVER, poolId: 1, maxLamports: '100000000', lamportsPerKm: '10000000', targetKm: 10,
        status: 'settled', createSignature: 'sigCreate', settled: true, earnedLamports: '50000000', refundedLamports: '50000000',
        createdAt: NOW.getTime(), settledAt: NOW.getTime(), signature: 'txSig', slot: '7',
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
