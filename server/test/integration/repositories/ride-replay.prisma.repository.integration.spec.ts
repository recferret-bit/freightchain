import { EMPTY_REPLAY_SCORES, RideReplay } from '../../../src/domain/verdict/ride-replay.entity.js';
import { VerdictStatus } from '../../../src/domain/verdict/verdict.dto.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { RideReplayPrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride-replay.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import { T0, at, freeRideAt, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('RideReplayPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService;
  let repo: RideReplayPrismaRepository;
  let rides: RidePrismaRepository;

  beforeAll(async () => {
    prisma = await testPrisma();
    repo = new RideReplayPrismaRepository(prisma);
    rides = new RidePrismaRepository(prisma);
  });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await wipe(prisma);
    await seedPlayer(prisma, 'w');
  });

  const started = async () => {
    const r = freeRideAt('w');
    r.start(T0);
    await rides.insert(r);
    return r;
  };

  it('saves, updates, and retrieves RideReplay and normalized RideReplayFlag rows in verdict schema', async () => {
    const ride = await started();
    expect(await repo.nextSeq(ride.id)).toBe(1);

    const replay = RideReplay.createPending({
      id: '00000000-0000-4000-8000-000000000101',
      rideId: ride.id,
      seq: 1,
      isPaid: false,
      seed: ride.seed,
      trip: ride.trip,
      now: T0,
    });
    await repo.save(replay);

    const pending = await repo.listPending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(replay.id);
    expect(await repo.nextSeq(ride.id)).toBe(2);

    replay.markStarted(at(1));
    replay.complete({
      batchesCount: 3,
      samplesCount: 450,
      recordedSeconds: 45,
      simulatedSeconds: 45,
      recordedDistance: 630,
      simulatedDistance: 630,
      recordedHull: 100,
      simulatedHull: 68,
      simulatedCrashesVehicle: 1,
      simulatedCrashesBuilding: 0,
      eventsExpected: 1,
      eventsCorrelated: 0,
      redFlags: [
        {
          code: 'traffic-collision-ignored',
          category: 'traffic',
          severity: 'reject',
          detail: 'drove straight through 1 backend traffic vehicle without slowing down',
          atSecond: 14.2,
          atMetre: 198.8,
          evidence: { carId: 3, kind: 'sedan' },
        },
      ],
      scores: {
        ...EMPTY_REPLAY_SCORES,
        trafficSpawned: 8,
        trafficContacts: 1,
        trafficCrashesIgnored: 1,
      },
      now: at(2),
    });
    await repo.save(replay);

    expect(await repo.listPending(10)).toEqual([]);

    const found = await repo.findById(replay.id);
    expect(found?.status).toBe(VerdictStatus.Rejected);
    expect(found?.redFlags).toHaveLength(1);
    expect(found?.redFlags[0]?.code).toBe('traffic-collision-ignored');
    expect(found?.redFlags[0]?.evidence).toEqual({ carId: 3, kind: 'sedan' });

    const latest = await repo.findLatestByRide(ride.id);
    expect(latest?.id).toBe(replay.id);

    const list = await repo.listByRide(ride.id);
    expect(list).toHaveLength(1);

    const recent = await repo.listRecent({ status: 'rejected', isPaid: false, limit: 10 });
    expect(recent).toHaveLength(1);
    expect(recent[0]?.id).toBe(replay.id);
    expect(await repo.listRecent({ isPaid: true, limit: 10 })).toEqual([]);
  });

  it('cascades RideReplay and RideReplayFlag when the parent Ride is deleted', async () => {
    const ride = await started();
    const replay = RideReplay.createPending({
      id: '00000000-0000-4000-8000-000000000102',
      rideId: ride.id,
      seq: 0,
      isPaid: false,
      seed: ride.seed,
      trip: ride.trip,
      now: T0,
    });
    replay.complete({
      batchesCount: 1,
      samplesCount: 10,
      recordedSeconds: 1,
      simulatedSeconds: 1,
      recordedDistance: 10,
      simulatedDistance: 10,
      recordedHull: 100,
      simulatedHull: 100,
      simulatedCrashesVehicle: 0,
      simulatedCrashesBuilding: 0,
      eventsExpected: 0,
      eventsCorrelated: 0,
      redFlags: [
        {
          code: 'event-unapplied',
          category: 'event',
          severity: 'flag',
          detail: 'unapplied effect',
          atSecond: null,
          atMetre: null,
          evidence: null,
        },
      ],
      scores: EMPTY_REPLAY_SCORES,
      now: at(1),
    });
    await repo.save(replay);

    await prisma.ride.delete({ where: { id: ride.id } });
    expect(await prisma.rideReplay.count()).toBe(0);
    expect(await prisma.rideReplayFlag.count()).toBe(0);
  });
});
