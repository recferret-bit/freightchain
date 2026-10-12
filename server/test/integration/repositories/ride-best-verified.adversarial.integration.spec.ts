import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import { PoolPrismaRepository } from '../../../src/infrastructure/prisma/repositories/pool.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { Ride } from '../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../src/domain/rides/ride-status.js';
import { aPool } from '../../support/pools.js';
import { T0, at, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('Adversarial Test: RidePrismaRepository.findBestVerifiedByPoolAndWallet', () => {
  let prisma: PrismaService;
  let repo: RidePrismaRepository;
  let poolRepo: PoolPrismaRepository;

  const DRIVER = 'DriverWallet111111111111111111111111111111';
  const ADMIN = 'AdminWallet1111111111111111111111111111111';

  beforeAll(async () => {
    prisma = await testPrisma();
    repo = new RidePrismaRepository(prisma);
    poolRepo = new PoolPrismaRepository(prisma);
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await wipe(prisma);
    await seedPlayer(prisma, DRIVER);
    await seedPlayer(prisma, ADMIN);
    await prisma.round.create({ data: { id: 1, startsAt: T0, endsAt: at(1000), carry: 0n, status: 'open' } });
    await poolRepo.upsert(aPool({ id: 1 }, T0));
  });

  it('correctly returns a ride with automated verified verdict', async () => {
    const created = Ride.createFromTicket({
      id: '00000000-0000-4000-8000-000000000001',
      wallet: DRIVER,
      tier: '1h',
      seed: 12345,
      minSeconds: 300,
      timeScale: 1,
      poolId: 1,
      roundId: 1,
      now: T0,
    });
    const ride = Ride.restore({ ...created.snapshot(), status: RideStatus.Completed, lastS: 25000, driveSeconds: 300, endedAt: at(300) });
    await repo.insert(ride);

    // Create verified verdict
    await prisma.rideVerdict.create({
      data: {
        rideId: ride.id,
        status: 'verified',
        reasons: [],
        scores: {},
        rulesVersion: 1,
        judgedAt: at(300),
      },
    });

    const best = await repo.findBestVerifiedByPoolAndWallet(1, DRIVER);
    expect(best).not.toBeNull();
    expect(best?.id).toBe(ride.id);
  });

  it('correctly ignores a ride with flagged or rejected verdict when not overridden', async () => {
    const created = Ride.createFromTicket({
      id: '00000000-0000-4000-8000-000000000002',
      wallet: DRIVER,
      tier: '1h',
      seed: 12345,
      minSeconds: 300,
      timeScale: 1,
      poolId: 1,
      roundId: 1,
      now: T0,
    });
    const ride = Ride.restore({ ...created.snapshot(), status: RideStatus.Completed, lastS: 25000, driveSeconds: 300, endedAt: at(300) });
    await repo.insert(ride);

    await prisma.rideVerdict.create({
      data: {
        rideId: ride.id,
        status: 'rejected',
        reasons: [{ code: 'speed_hack' }],
        scores: {},
        rulesVersion: 1,
        judgedAt: at(300),
      },
    });

    const best = await repo.findBestVerifiedByPoolAndWallet(1, DRIVER);
    expect(best).toBeNull();
  });

  it('strictly excludes an ADMIN-REJECTED ride even if overriddenBy is not null', async () => {
    const created = Ride.createFromTicket({
      id: '00000000-0000-4000-8000-000000000003',
      wallet: DRIVER,
      tier: '1h',
      seed: 12345,
      minSeconds: 300,
      timeScale: 1,
      poolId: 1,
      roundId: 1,
      now: T0,
    });
    const ride = Ride.restore({ ...created.snapshot(), status: RideStatus.Completed, lastS: 25000, driveSeconds: 300, endedAt: at(300) });
    await repo.insert(ride);

    // Admin manually reviews and REJECTS the ride for cheating
    await prisma.rideVerdict.create({
      data: {
        rideId: ride.id,
        status: 'rejected', // EXPLICITLY REJECTED!
        reasons: [{ code: 'confirmed_bot' }],
        scores: {},
        rulesVersion: 1,
        judgedAt: at(300),
        overriddenBy: ADMIN, // Set by admin
        overriddenAt: at(350),
        note: 'Confirmed cheating bot',
      },
    });

    const best = await repo.findBestVerifiedByPoolAndWallet(1, DRIVER);
    expect(best).toBeNull();
  });

  it('correctly returns an ADMIN-VERIFIED ride when overriddenBy is set and status is verified', async () => {
    const created = Ride.createFromTicket({
      id: '00000000-0000-4000-8000-000000000004',
      wallet: DRIVER,
      tier: '1h',
      seed: 12345,
      minSeconds: 300,
      timeScale: 1,
      poolId: 1,
      roundId: 1,
      now: T0,
    });
    const ride = Ride.restore({ ...created.snapshot(), status: RideStatus.Completed, lastS: 25000, driveSeconds: 300, endedAt: at(300) });
    await repo.insert(ride);

    // Admin manually reviews and VERIFIES the ride
    await prisma.rideVerdict.create({
      data: {
        rideId: ride.id,
        status: 'verified',
        reasons: [],
        scores: {},
        rulesVersion: 1,
        judgedAt: at(300),
        overriddenBy: ADMIN,
        overriddenAt: at(350),
        note: 'Admin verified after manual review',
      },
    });

    const best = await repo.findBestVerifiedByPoolAndWallet(1, DRIVER);
    expect(best).not.toBeNull();
    expect(best?.id).toBe(ride.id);
  });
});
