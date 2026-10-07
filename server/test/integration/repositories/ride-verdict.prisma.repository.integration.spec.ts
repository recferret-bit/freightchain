import { RideVerdictPrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride-verdict.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import { RideVerdict } from '../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../src/domain/verdict/verdict.dto.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, freeRideAt, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('RideVerdictPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: RideVerdictPrismaRepository, rides: RidePrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new RideVerdictPrismaRepository(prisma); rides = new RidePrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); await seedPlayer(prisma, 'w'); });

  const verdict = (rideId: string, status: VerdictStatus, when = T0) => RideVerdict.restore({
    rideId, status, rulesVersion: 1, judgedAt: when, version: 1,
    reasons: status === VerdictStatus.Verified ? [] : [{ code: 'no-recording', detail: 'none', severity: 'reject' }],
    scores: { recording: { batches: 0, samples: 0, inputs: 0, recordedSeconds: 0, coverage: 0, maxSpeed: 0 }, human: { presses: 0, minHoldCv: null, repeatShare: null, instantShare: null } },
  });

  it('round-trips a verdict (enum, JSON reasons and scores, time); a second save replaces it and bumps the version', async () => {
    const ride = freeRideAt('w'); await rides.insert(ride);
    const first = verdict(ride.id, VerdictStatus.Rejected);
    await repo.save(first);
    expect((await repo.findByRide(ride.id))?.snapshot()).toEqual(first.snapshot());
    await repo.save(verdict(ride.id, VerdictStatus.Verified, at(5)));
    expect((await repo.findByRide(ride.id))?.snapshot()).toMatchObject({ status: 'verified', reasons: [], judgedAt: at(5), version: 2 });
    expect(await prisma.rideVerdict.count()).toBe(1);
    expect(await repo.findByRide('00000000-0000-4000-8000-ffffffffffff')).toBeNull();
  });

  it('an admin override round-trips (who, when, note) and survives a later save of the same verdict', async () => {
    const ride = freeRideAt('w'); await rides.insert(ride);
    const v = verdict(ride.id, VerdictStatus.Flagged);
    await repo.save(v);
    v.override(VerdictStatus.Verified, 'ADMIN', 'looks human', at(9));
    await repo.save(v);
    const back = await repo.findByRide(ride.id);
    expect(back?.snapshot()).toMatchObject({ status: 'verified', overriddenBy: 'ADMIN', overriddenAt: at(9), note: 'looks human' });
    expect(back?.isOverridden).toBe(true);
  });

  it('a verdict goes with its ride (cascade)', async () => {
    const ride = freeRideAt('w'); await rides.insert(ride);
    await repo.save(verdict(ride.id, VerdictStatus.Flagged));
    await prisma.ride.delete({ where: { id: ride.id } });
    expect(await prisma.rideVerdict.count()).toBe(0);
  });
});
