import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { PledgePrismaRepository } from '../../../src/infrastructure/prisma/repositories/pledge.prisma.repository.js';
import { PoolPrismaRepository } from '../../../src/infrastructure/prisma/repositories/pool.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { Pledge } from '../../../src/domain/economy/pledge.entity.js';
import { aPool } from '../../support/pools.js';
import { T0, at, freeRideAt, inTx, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('PledgePrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService;
  let repo: PledgePrismaRepository;
  let poolRepo: PoolPrismaRepository;
  let rideRepo: RidePrismaRepository;

  const SPONSOR = 'SponsorWallet111111111111111111111111111111';
  const DRIVER = 'DriverWallet111111111111111111111111111111';

  beforeAll(async () => {
    prisma = await testPrisma();
    repo = new PledgePrismaRepository(prisma);
    poolRepo = new PoolPrismaRepository(prisma);
    rideRepo = new RidePrismaRepository(prisma);
  });
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await wipe(prisma);
    await seedPlayer(prisma, SPONSOR);
    await seedPlayer(prisma, DRIVER);
    await poolRepo.upsert(aPool({ id: 1 }, T0));
  });

  it('inserts and finds by id, pdaAddress, (rideId, sponsor), rideId, driver, and sponsor', async () => {
    const ride = freeRideAt(DRIVER, T0);
    await rideRepo.insert(ride);

    const pledge = Pledge.create({
      id: '00000000-0000-4000-8000-000000000001',
      pdaAddress: 'PledgePDA111111111111111111111111111111111',
      rideId: ride.id,
      sponsor: SPONSOR,
      driver: DRIVER,
      poolId: 1,
      lamportsPerKm: 10_000_000n,
      targetKm: 50,
      now: T0,
      blockhash: '5tY...blockhash',
    });

    await repo.insert(pledge);

    const foundById = await repo.findById(pledge.id);
    expect(foundById).not.toBeNull();
    expect(foundById!.snapshot()).toEqual(pledge.snapshot());

    const foundByPda = await repo.findByPdaAddress(pledge.pdaAddress);
    expect(foundByPda?.id).toBe(pledge.id);

    const foundByRideAndSponsor = await repo.findByRideAndSponsor(ride.id, SPONSOR);
    expect(foundByRideAndSponsor?.id).toBe(pledge.id);

    const forRide = await repo.findByRideId(ride.id);
    expect(forRide).toHaveLength(1);
    expect(forRide[0].id).toBe(pledge.id);

    const forDriver = await repo.findByDriver(DRIVER);
    expect(forDriver).toHaveLength(1);
    expect(forDriver[0].id).toBe(pledge.id);

    const forSponsor = await repo.findBySponsor(SPONSOR);
    expect(forSponsor).toHaveLength(1);
    expect(forSponsor[0].id).toBe(pledge.id);
  });

  it('saves settlement state with full 64-bit BigInt precision', async () => {
    const ride = freeRideAt(DRIVER, T0);
    await rideRepo.insert(ride);

    const pledge = Pledge.create({
      id: '00000000-0000-4000-8000-000000000002',
      pdaAddress: 'PledgePDA222222222222222222222222222222222',
      rideId: ride.id,
      sponsor: SPONSOR,
      driver: DRIVER,
      poolId: 1,
      lamportsPerKm: 10_000_000_000n, // 10 SOL per km
      targetKm: 100, // 1000 SOL total
      now: T0,
    });
    await repo.insert(pledge);

    const settleTime = at(3600);
    pledge.settle(60, false, settleTime, 'txSignature123', 987654321n);
    await repo.save(pledge);

    const reloaded = await repo.findById(pledge.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.isSettled).toBe(true);
    expect(reloaded!.earnedLamports).toBe(600_000_000_000n);
    expect(reloaded!.refundedLamports).toBe(400_000_000_000n);
    expect(reloaded!.signature).toBe('txSignature123');
    expect(reloaded!.slot).toBe(987654321n);
    expect(reloaded!.settledAt).toEqual(settleTime);
  });

  it('rolls back on transaction abort', async () => {
    const ride = freeRideAt(DRIVER, T0);
    await rideRepo.insert(ride);

    const pledge = Pledge.create({
      id: '00000000-0000-4000-8000-000000000003',
      pdaAddress: 'PledgePDA333333333333333333333333333333333',
      rideId: ride.id,
      sponsor: SPONSOR,
      driver: DRIVER,
      poolId: 1,
      lamportsPerKm: 1_000_000n,
      targetKm: 10,
      now: T0,
    });

    await expect(inTx(prisma, async (tx) => {
      await repo.insert(pledge, tx);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');

    expect(await repo.findById(pledge.id)).toBeNull();
  });
});
