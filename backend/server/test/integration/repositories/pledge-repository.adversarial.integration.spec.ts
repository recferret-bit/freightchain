import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { PledgePrismaRepository } from '../../../src/infrastructure/prisma/repositories/pledge.prisma.repository.js';
import { PoolPrismaRepository } from '../../../src/infrastructure/prisma/repositories/pool.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { Pledge } from '../../../src/domain/economy/pledge.entity.js';
import { aPool } from '../../support/pools.js';
import { T0, at, freeRideAt, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('Adversarial Stress Test: PledgePrismaRepository (PostgreSQL Constraints & Concurrency)', () => {
  let prisma: PrismaService;
  let repo: PledgePrismaRepository;
  let poolRepo: PoolPrismaRepository;
  let rideRepo: RidePrismaRepository;

  const SPONSOR_1 = 'SponsorWallet111111111111111111111111111111';
  const SPONSOR_2 = 'SponsorWallet222222222222222222222222222222';
  const DRIVER_1 = 'DriverWallet111111111111111111111111111111';
  const DRIVER_2 = 'DriverWallet222222222222222222222222222222';

  beforeAll(async () => {
    prisma = await testPrisma();
    repo = new PledgePrismaRepository(prisma);
    poolRepo = new PoolPrismaRepository(prisma);
    rideRepo = new RidePrismaRepository(prisma);
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await wipe(prisma);
    await seedPlayer(prisma, SPONSOR_1);
    await seedPlayer(prisma, SPONSOR_2);
    await seedPlayer(prisma, DRIVER_1);
    await seedPlayer(prisma, DRIVER_2);
    await poolRepo.upsert(aPool({ id: 1 }, T0));
    await poolRepo.upsert(aPool({ id: 2 }, T0));
  });

  describe('PostgreSQL Integrity Constraints', () => {
    it('enforces primary key uniqueness on id', async () => {
      const ride = freeRideAt(DRIVER_1, T0);
      await rideRepo.insert(ride);

      const p1 = Pledge.create({
        id: '00000000-0000-4000-8000-000000000001',
        pdaAddress: 'PDA_ADDR_111111111111111111111111111111111',
        rideId: ride.id,
        sponsor: SPONSOR_1,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: T0,
      });
      await repo.insert(p1);

      const p2 = Pledge.create({
        id: '00000000-0000-4000-8000-000000000001', // duplicate id
        pdaAddress: 'PDA_ADDR_222222222222222222222222222222222',
        rideId: ride.id,
        sponsor: SPONSOR_2,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: T0,
      });

      await expect(repo.insert(p2)).rejects.toThrow();
    });

    it('enforces uniqueness on pdaAddress', async () => {
      const ride = freeRideAt(DRIVER_1, T0);
      await rideRepo.insert(ride);

      const p1 = Pledge.create({
        id: '00000000-0000-4000-8000-000000000001',
        pdaAddress: 'DUPLICATE_PDA_ADDRESS_111111111111111111',
        rideId: ride.id,
        sponsor: SPONSOR_1,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: T0,
      });
      await repo.insert(p1);

      const p2 = Pledge.create({
        id: '00000000-0000-4000-8000-000000000002',
        pdaAddress: 'DUPLICATE_PDA_ADDRESS_111111111111111111', // duplicate PDA
        rideId: ride.id,
        sponsor: SPONSOR_2,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: T0,
      });

      await expect(repo.insert(p2)).rejects.toThrow();
    });

    it('enforces compound uniqueness on [rideId, sponsor] (one pledge per sponsor per ride)', async () => {
      const ride = freeRideAt(DRIVER_1, T0);
      await rideRepo.insert(ride);

      const p1 = Pledge.create({
        id: '00000000-0000-4000-8000-000000000001',
        pdaAddress: 'PDA_ADDR_111111111111111111111111111111111',
        rideId: ride.id,
        sponsor: SPONSOR_1,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: T0,
      });
      await repo.insert(p1);

      const p2 = Pledge.create({
        id: '00000000-0000-4000-8000-000000000002',
        pdaAddress: 'PDA_ADDR_222222222222222222222222222222222',
        rideId: ride.id, // SAME rideId
        sponsor: SPONSOR_1, // SAME sponsor
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 2_000_000n,
        targetKm: 20,
        now: T0,
      });

      await expect(repo.insert(p2)).rejects.toThrow();
    });

    it('enforces foreign key to Ride', async () => {
      const nonExistentRideId = '99999999-9999-4999-8999-999999999999';
      const p = Pledge.create({
        id: '00000000-0000-4000-8000-000000000001',
        pdaAddress: 'PDA_ADDR_111111111111111111111111111111111',
        rideId: nonExistentRideId,
        sponsor: SPONSOR_1,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: T0,
      });

      await expect(repo.insert(p)).rejects.toThrow();
    });

    it('enforces foreign key to Sponsor player wallet', async () => {
      const ride = freeRideAt(DRIVER_1, T0);
      await rideRepo.insert(ride);

      const unknownSponsor = 'NonExistentSponsorWallet1111111111111111';
      const p = Pledge.create({
        id: '00000000-0000-4000-8000-000000000001',
        pdaAddress: 'PDA_ADDR_111111111111111111111111111111111',
        rideId: ride.id,
        sponsor: unknownSponsor,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: T0,
      });

      await expect(repo.insert(p)).rejects.toThrow();
    });

    it('enforces foreign key to Driver player wallet', async () => {
      const ride = freeRideAt(DRIVER_1, T0);
      await rideRepo.insert(ride);

      const unknownDriver = 'NonExistentDriverWallet11111111111111111';
      const p = Pledge.create({
        id: '00000000-0000-4000-8000-000000000001',
        pdaAddress: 'PDA_ADDR_111111111111111111111111111111111',
        rideId: ride.id,
        sponsor: SPONSOR_1,
        driver: unknownDriver,
        poolId: 1,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: T0,
      });

      await expect(repo.insert(p)).rejects.toThrow();
    });

    it('enforces foreign key to Pool', async () => {
      const ride = freeRideAt(DRIVER_1, T0);
      await rideRepo.insert(ride);

      const unknownPoolId = 99999;
      const p = Pledge.create({
        id: '00000000-0000-4000-8000-000000000001',
        pdaAddress: 'PDA_ADDR_111111111111111111111111111111111',
        rideId: ride.id,
        sponsor: SPONSOR_1,
        driver: DRIVER_1,
        poolId: unknownPoolId,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: T0,
      });

      await expect(repo.insert(p)).rejects.toThrow();
    });
  });

  describe('PostgreSQL BIGINT boundaries vs Solana u64', () => {
    it('supports maximum signed 64-bit integer (i64::MAX = 9,223,372,036,854,775,807)', async () => {
      const ride = freeRideAt(DRIVER_1, T0);
      await rideRepo.insert(ride);

      const maxSigned64 = 9_223_372_036_854_775_807n;
      const p = Pledge.create({
        id: '00000000-0000-4000-8000-000000000001',
        pdaAddress: 'PDA_ADDR_MAX_BIGINT_111111111111111111111',
        rideId: ride.id,
        sponsor: SPONSOR_1,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: maxSigned64,
        targetKm: 1,
        now: T0,
      });

      await repo.insert(p);
      const reloaded = await repo.findById(p.id);
      expect(reloaded).not.toBeNull();
      expect(reloaded!.snapshot().maxLamports).toBe(maxSigned64);
      expect(reloaded!.snapshot().lamportsPerKm).toBe(maxSigned64);
    });

    it('FINDING: PostgreSQL rejects unsigned 64-bit values > i64::MAX (e.g. u64 upper half)', async () => {
      const ride = freeRideAt(DRIVER_1, T0);
      await rideRepo.insert(ride);

      // In Solana Rust contract, u64 allows values up to 18_446_744_073_709_551_615.
      // But PostgreSQL BIGINT is signed (max 9_223_372_036_854_775_807).
      const overflowI64 = 9_223_372_036_854_775_808n; // i64::MAX + 1
      const p = Pledge.create({
        id: '00000000-0000-4000-8000-000000000002',
        pdaAddress: 'PDA_ADDR_OVERFLOW_BIGINT_11111111111111111',
        rideId: ride.id,
        sponsor: SPONSOR_1,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: overflowI64,
        targetKm: 1,
        now: T0,
      });

      // PostgreSQL or Prisma throws when attempting to store u64 > i64::MAX
      await expect(repo.insert(p)).rejects.toThrow();
    });
  });

  describe('Concurrency & Race Conditions', () => {
    it('handles concurrent identical inserts: exactly one succeeds and one fails', async () => {
      const ride = freeRideAt(DRIVER_1, T0);
      await rideRepo.insert(ride);

      const p1 = Pledge.create({
        id: '00000000-0000-4000-8000-000000000001',
        pdaAddress: 'PDA_CONCURRENT_11111111111111111111111111',
        rideId: ride.id,
        sponsor: SPONSOR_1,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: T0,
      });

      const p2 = Pledge.create({
        id: '00000000-0000-4000-8000-000000000002',
        pdaAddress: 'PDA_CONCURRENT_22222222222222222222222222',
        rideId: ride.id,
        sponsor: SPONSOR_1, // SAME sponsor for SAME ride
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 2_000_000n,
        targetKm: 10,
        now: T0,
      });

      const results = await Promise.allSettled([
        repo.insert(p1),
        repo.insert(p2),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });
  });

  describe('Query Filtering and Sorting Order', () => {
    it('findByRideId returns all pledges sorted by createdAt ASC', async () => {
      const ride = freeRideAt(DRIVER_1, T0);
      await rideRepo.insert(ride);

      const p1 = Pledge.create({
        id: '00000000-0000-4000-8000-000000000001',
        pdaAddress: 'PDA_ORDER_111111111111111111111111111111111',
        rideId: ride.id,
        sponsor: SPONSOR_1,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: at(10),
      });
      const p2 = Pledge.create({
        id: '00000000-0000-4000-8000-000000000002',
        pdaAddress: 'PDA_ORDER_222222222222222222222222222222222',
        rideId: ride.id,
        sponsor: SPONSOR_2,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: at(20),
      });

      await repo.insert(p2);
      await repo.insert(p1);

      const pledges = await repo.findByRideId(ride.id);
      expect(pledges).toHaveLength(2);
      expect(pledges[0].id).toBe(p1.id); // at(10) comes before at(20)
      expect(pledges[1].id).toBe(p2.id);
    });

    it('findByDriver and findBySponsor return pledges sorted by createdAt DESC', async () => {
      const ride1 = freeRideAt(DRIVER_1, T0);
      const ride2 = freeRideAt(DRIVER_1, at(5));
      await rideRepo.insert(ride1);
      await rideRepo.insert(ride2);

      const p1 = Pledge.create({
        id: '00000000-0000-4000-8000-000000000001',
        pdaAddress: 'PDA_SORT_111111111111111111111111111111111',
        rideId: ride1.id,
        sponsor: SPONSOR_1,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: at(10),
      });
      const p2 = Pledge.create({
        id: '00000000-0000-4000-8000-000000000002',
        pdaAddress: 'PDA_SORT_222222222222222222222222222222222',
        rideId: ride2.id,
        sponsor: SPONSOR_1,
        driver: DRIVER_1,
        poolId: 1,
        lamportsPerKm: 1_000_000n,
        targetKm: 10,
        now: at(50),
      });

      await repo.insert(p1);
      await repo.insert(p2);

      const driverPledges = await repo.findByDriver(DRIVER_1);
      expect(driverPledges[0].id).toBe(p2.id); // at(50) before at(10)
      expect(driverPledges[1].id).toBe(p1.id);

      const sponsorPledges = await repo.findBySponsor(SPONSOR_1);
      expect(sponsorPledges[0].id).toBe(p2.id);
      expect(sponsorPledges[1].id).toBe(p1.id);
    });
  });
});
