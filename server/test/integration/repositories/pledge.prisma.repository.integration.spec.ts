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
    expect(foundById!.status).toBe('pending');

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

  const pledgeOn = (rideId: string, n: number, poolId = 1, sponsor = SPONSOR) => Pledge.create({
    id: `00000000-0000-4000-8000-00000000010${n}`, pdaAddress: `PledgePDA${n}`.padEnd(43, '1'), rideId, sponsor, driver: DRIVER, poolId,
    lamportsPerKm: 10_000_000_000n, targetKm: 100, now: at(n),
  });
  const created = (p: Pledge, signature: string) => ({ kind: 'PledgeCreated' as const, signature, slot: 5, rideId: p.rideId, sponsor: p.sponsor, driver: p.driver, pool: 'pool', maxLamports: p.maxLamports, lamportsPerKm: p.lamportsPerKm, targetKm: p.targetKm });

  it('status, createSignature and the settlement round-trip with full 64-bit precision', async () => {
    const ride = freeRideAt(DRIVER, T0);
    await rideRepo.insert(ride);
    const pledge = pledgeOn(ride.id, 2); // 10 SOL a km × 100 km = 1 000 SOL
    await repo.insert(pledge);
    expect((await repo.findById(pledge.id))!.status).toBe('pending');

    pledge.apply(created(pledge, 'createSig'), at(10));
    await repo.save(pledge);
    expect((await repo.findById(pledge.id))!.snapshot()).toMatchObject({ status: 'active', createSignature: 'createSig', settled: false });

    pledge.apply({ kind: 'PledgeSettled', signature: 'settleSig', slot: 987654321, rideId: ride.id, sponsor: SPONSOR, driver: DRIVER, pool: 'pool', verifiedKm: 60, earnedLamports: 600_000_000_000n, refundedLamports: 400_000_000_000n }, at(3600));
    await repo.save(pledge);
    const reloaded = (await repo.findById(pledge.id))!;
    expect(reloaded.snapshot()).toEqual(pledge.snapshot());
    expect(reloaded).toMatchObject({ status: 'settled', isSettled: true, earnedLamports: 600_000_000_000n, refundedLamports: 400_000_000_000n, signature: 'settleSig', slot: 987654321n, settledAt: at(3600) });
  });

  it('listOpen = pending + active, oldest first; listActiveByPool = one pool\'s active pledges', async () => {
    await poolRepo.upsert(aPool({ id: 2 }, T0));
    const ride = freeRideAt(DRIVER, T0);
    await rideRepo.insert(ride);
    const sponsors = ['Sponsor2', 'Sponsor3', 'Sponsor4', 'Sponsor5'].map((w) => w.padEnd(43, '1'));
    for (const w of sponsors) await seedPlayer(prisma, w);
    const [pending, active1, active2, settled] = [pledgeOn(ride.id, 1, 1, sponsors[0]), pledgeOn(ride.id, 2, 1, sponsors[1]), pledgeOn(ride.id, 3, 2, sponsors[2]), pledgeOn(ride.id, 4, 1, sponsors[3])];
    active1.apply(created(active1, 'c1'), T0);
    active2.apply(created(active2, 'c2'), T0);
    settled.apply({ kind: 'PledgeRefunded', signature: 'r', slot: 1, rideId: ride.id, sponsor: settled.sponsor, driver: DRIVER, pool: 'pool', refundedLamports: settled.maxLamports }, T0);
    for (const p of [settled, active2, active1, pending]) await repo.insert(p);
    expect((await repo.listOpen()).map((p) => p.id)).toEqual([pending.id, active1.id, active2.id]);
    expect((await repo.listActiveByPool(1)).map((p) => p.id)).toEqual([active1.id]);
    expect((await repo.listActiveByPool(2)).map((p) => p.id)).toEqual([active2.id]);
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
