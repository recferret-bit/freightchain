import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import { PoolPrismaRepository } from '../../../src/infrastructure/prisma/repositories/pool.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { Ride } from '../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../src/domain/rides/ride-status.js';
import { aPool } from '../../support/pools.js';
import { T0, at, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('Adversarial Verification Challenger M3-2 Integration: Complex Verdict Filtering & Ordering', () => {
  let prisma: PrismaService;
  let repo: RidePrismaRepository;
  let poolRepo: PoolPrismaRepository;

  const DRIVER_A = 'DriverWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const DRIVER_B = 'DriverWalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const ADMIN = 'AdminWallet1111111111111111111111111111111';

  beforeAll(async () => {
    prisma = await testPrisma();
    repo = new RidePrismaRepository(prisma);
    poolRepo = new PoolPrismaRepository(prisma);
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await wipe(prisma);
    await seedPlayer(prisma, DRIVER_A);
    await seedPlayer(prisma, DRIVER_B);
    await seedPlayer(prisma, ADMIN);
    await prisma.round.create({ data: { id: 1, startsAt: T0, endsAt: at(1000), carry: 0n, status: 'open' } });
    await poolRepo.upsert(aPool({ id: 1 }, T0));
    await poolRepo.upsert(aPool({ id: 2 }, T0));
  });

  it('selects best verified ride across multiple mixed rides (ignoring longer rejected rides)', async () => {
    // Ride 1: Automated verified (lastS: 10000)
    const ride1 = Ride.restore({
      ...Ride.createFromTicket({
        id: '00000000-0000-4000-8000-000000000011',
        wallet: DRIVER_A,
        tier: '1h',
        seed: 12345,
        minSeconds: 300,
        timeScale: 1,
        poolId: 1,
        roundId: 1,
        now: T0,
      }).snapshot(),
      status: RideStatus.Completed,
      lastS: 10000,
      driveSeconds: 200,
      endedAt: at(200),
    });
    await repo.insert(ride1);
    await prisma.rideVerdict.create({
      data: { rideId: ride1.id, status: 'verified', reasons: [], scores: {}, rulesVersion: 1, judgedAt: at(200) },
    });

    // Ride 2: Automated rejected (lastS: 25000) - longer distance but cheated
    const ride2 = Ride.restore({
      ...Ride.createFromTicket({
        id: '00000000-0000-4000-8000-000000000012',
        wallet: DRIVER_A,
        tier: '1h',
        seed: 12345,
        minSeconds: 300,
        timeScale: 1,
        poolId: 1,
        roundId: 1,
        now: T0,
      }).snapshot(),
      status: RideStatus.Completed,
      lastS: 25000,
      driveSeconds: 300,
      endedAt: at(300),
    });
    await repo.insert(ride2);
    await prisma.rideVerdict.create({
      data: { rideId: ride2.id, status: 'rejected', reasons: [{ code: 'speed_hack' }], scores: {}, rulesVersion: 1, judgedAt: at(300) },
    });

    // Ride 3: Admin overridden REJECTED (lastS: 30000) - longest distance but manually rejected
    const ride3 = Ride.restore({
      ...Ride.createFromTicket({
        id: '00000000-0000-4000-8000-000000000013',
        wallet: DRIVER_A,
        tier: '1h',
        seed: 12345,
        minSeconds: 300,
        timeScale: 1,
        poolId: 1,
        roundId: 1,
        now: T0,
      }).snapshot(),
      status: RideStatus.Completed,
      lastS: 30000,
      driveSeconds: 350,
      endedAt: at(350),
    });
    await repo.insert(ride3);
    await prisma.rideVerdict.create({
      data: {
        rideId: ride3.id,
        status: 'rejected',
        reasons: [{ code: 'bot' }],
        scores: {},
        rulesVersion: 1,
        judgedAt: at(350),
        overriddenBy: ADMIN,
        overriddenAt: at(360),
      },
    });

    // Ride 4: Admin overridden VERIFIED (lastS: 20000)
    const ride4 = Ride.restore({
      ...Ride.createFromTicket({
        id: '00000000-0000-4000-8000-000000000014',
        wallet: DRIVER_A,
        tier: '1h',
        seed: 12345,
        minSeconds: 300,
        timeScale: 1,
        poolId: 1,
        roundId: 1,
        now: T0,
      }).snapshot(),
      status: RideStatus.Completed,
      lastS: 20000,
      driveSeconds: 250,
      endedAt: at(250),
    });
    await repo.insert(ride4);
    await prisma.rideVerdict.create({
      data: {
        rideId: ride4.id,
        status: 'verified',
        reasons: [],
        scores: {},
        rulesVersion: 1,
        judgedAt: at(250),
        overriddenBy: ADMIN,
        overriddenAt: at(260),
      },
    });

    // Best verified ride must be ride4 (lastS 20000, verified)
    // NOT ride3 (lastS 30000, admin rejected) and NOT ride2 (lastS 25000, rejected)
    const best = await repo.findBestVerifiedByPoolAndWallet(1, DRIVER_A);
    expect(best).not.toBeNull();
    expect(best?.id).toBe(ride4.id);
    expect(best?.distance).toBe(20000);
  });

  it('breaks ties on distance by choosing lowest driveSeconds', async () => {
    // Slower ride: 25000m in 350s
    const slowRide = Ride.restore({
      ...Ride.createFromTicket({
        id: '00000000-0000-4000-8000-000000000021',
        wallet: DRIVER_A,
        tier: '1h',
        seed: 12345,
        minSeconds: 300,
        timeScale: 1,
        poolId: 1,
        roundId: 1,
        now: T0,
      }).snapshot(),
      status: RideStatus.Completed,
      lastS: 25000,
      driveSeconds: 350,
      endedAt: at(350),
    });
    await repo.insert(slowRide);
    await prisma.rideVerdict.create({
      data: { rideId: slowRide.id, status: 'verified', reasons: [], scores: {}, rulesVersion: 1, judgedAt: at(350) },
    });

    // Faster ride: 25000m in 280s
    const fastRide = Ride.restore({
      ...Ride.createFromTicket({
        id: '00000000-0000-4000-8000-000000000022',
        wallet: DRIVER_A,
        tier: '1h',
        seed: 12345,
        minSeconds: 300,
        timeScale: 1,
        poolId: 1,
        roundId: 1,
        now: T0,
      }).snapshot(),
      status: RideStatus.Completed,
      lastS: 25000,
      driveSeconds: 280,
      endedAt: at(280),
    });
    await repo.insert(fastRide);
    await prisma.rideVerdict.create({
      data: { rideId: fastRide.id, status: 'verified', reasons: [], scores: {}, rulesVersion: 1, judgedAt: at(280) },
    });

    const best = await repo.findBestVerifiedByPoolAndWallet(1, DRIVER_A);
    expect(best).not.toBeNull();
    expect(best?.id).toBe(fastRide.id);
    expect(best?.driveSeconds).toBe(280);
  });

  it('strictly excludes non-completed rides even if verdict exists and distance is larger', async () => {
    // Abandoned ride with huge distance
    const abandoned = Ride.restore({
      ...Ride.createFromTicket({
        id: '00000000-0000-4000-8000-000000000031',
        wallet: DRIVER_A,
        tier: '1h',
        seed: 12345,
        minSeconds: 300,
        timeScale: 1,
        poolId: 1,
        roundId: 1,
        now: T0,
      }).snapshot(),
      status: RideStatus.Abandoned,
      lastS: 50000,
      driveSeconds: 500,
      endedAt: at(500),
    });
    await repo.insert(abandoned);
    await prisma.rideVerdict.create({
      data: { rideId: abandoned.id, status: 'verified', reasons: [], scores: {}, rulesVersion: 1, judgedAt: at(500) },
    });

    // Valid completed ride
    const completed = Ride.restore({
      ...Ride.createFromTicket({
        id: '00000000-0000-4000-8000-000000000032',
        wallet: DRIVER_A,
        tier: '1h',
        seed: 12345,
        minSeconds: 300,
        timeScale: 1,
        poolId: 1,
        roundId: 1,
        now: T0,
      }).snapshot(),
      status: RideStatus.Completed,
      lastS: 15000,
      driveSeconds: 250,
      endedAt: at(250),
    });
    await repo.insert(completed);
    await prisma.rideVerdict.create({
      data: { rideId: completed.id, status: 'verified', reasons: [], scores: {}, rulesVersion: 1, judgedAt: at(250) },
    });

    const best = await repo.findBestVerifiedByPoolAndWallet(1, DRIVER_A);
    expect(best).not.toBeNull();
    expect(best?.id).toBe(completed.id);
  });

  it('strictly isolates queries by driver and pool', async () => {
    // Driver B completed in Pool 1
    const rideB = Ride.restore({
      ...Ride.createFromTicket({
        id: '00000000-0000-4000-8000-000000000041',
        wallet: DRIVER_B,
        tier: '1h',
        seed: 12345,
        minSeconds: 300,
        timeScale: 1,
        poolId: 1,
        roundId: 1,
        now: T0,
      }).snapshot(),
      status: RideStatus.Completed,
      lastS: 30000,
      driveSeconds: 300,
      endedAt: at(300),
    });
    await repo.insert(rideB);
    await prisma.rideVerdict.create({
      data: { rideId: rideB.id, status: 'verified', reasons: [], scores: {}, rulesVersion: 1, judgedAt: at(300) },
    });

    // Driver A completed in Pool 2
    const rideA_Pool2 = Ride.restore({
      ...Ride.createFromTicket({
        id: '00000000-0000-4000-8000-000000000042',
        wallet: DRIVER_A,
        tier: '1h',
        seed: 12345,
        minSeconds: 300,
        timeScale: 1,
        poolId: 2,
        roundId: 1,
        now: T0,
      }).snapshot(),
      status: RideStatus.Completed,
      lastS: 25000,
      driveSeconds: 300,
      endedAt: at(300),
    });
    await repo.insert(rideA_Pool2);
    await prisma.rideVerdict.create({
      data: { rideId: rideA_Pool2.id, status: 'verified', reasons: [], scores: {}, rulesVersion: 1, judgedAt: at(300) },
    });

    // Query Driver A in Pool 1 -> must be null
    const bestA_Pool1 = await repo.findBestVerifiedByPoolAndWallet(1, DRIVER_A);
    expect(bestA_Pool1).toBeNull();

    // Query Driver A in Pool 2 -> must be rideA_Pool2
    const bestA_Pool2 = await repo.findBestVerifiedByPoolAndWallet(2, DRIVER_A);
    expect(bestA_Pool2?.id).toBe(rideA_Pool2.id);

    // Query Driver B in Pool 1 -> must be rideB
    const bestB_Pool1 = await repo.findBestVerifiedByPoolAndWallet(1, DRIVER_B);
    expect(bestB_Pool1?.id).toBe(rideB.id);
  });
});
