import { RideBatchPrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride-batch.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import { RideBatch } from '../../../src/domain/telemetry/ride-batch.entity.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, freeRideAt, seedPlayer, testPrisma, wipe } from '../../support/db.js';
import { hashBatch, recording } from '../../support/recording.js';

describe('RideBatchPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: RideBatchPrismaRepository, rides: RidePrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new RideBatchPrismaRepository(prisma); rides = new RidePrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); await seedPlayer(prisma, 'w'); });

  const started = async () => { const r = freeRideAt('w'); r.start(T0); await rides.insert(r); return r; };

  it('round-trips a batch through gzip (body, hashes, counts, time), ordered by seq', async () => {
    const ride = await started();
    const bodies = recording(ride.id, { seconds: 40 });
    for (const b of [bodies[2]!, bodies[0]!, bodies[1]!]) expect(await repo.insert(RideBatch.accept(ride.id, b, hashBatch(b), at(b.seq)))).toBe(true);
    const stored = await repo.listByRide(ride.id);
    expect(stored.map((b) => b.seq)).toEqual([0, 1, 2]);
    expect(stored[1]?.snapshot()).toEqual(RideBatch.accept(ride.id, bodies[1]!, hashBatch(bodies[1]!), at(1)).snapshot());
    const row = await prisma.rideBatch.findUniqueOrThrow({ where: { rideId_seq: { rideId: ride.id, seq: 0 } } });
    expect(row.payload.byteLength).toBeLessThan(row.bytes / 3); // gzip earns its keep on the sample rows
    expect(await repo.listByRide('00000000-0000-4000-8000-ffffffffffff')).toEqual([]);
  });

  it('a second insert of the same (rideId, seq) is false and leaves the first row untouched', async () => {
    const ride = await started();
    const [b0] = recording(ride.id, { seconds: 10 });
    expect(await repo.insert(RideBatch.accept(ride.id, b0!, hashBatch(b0!), T0))).toBe(true);
    expect(await repo.insert(RideBatch.accept(ride.id, { ...b0!, samples: [] }, 'x', at(5)))).toBe(false);
    expect((await repo.listByRide(ride.id))[0]?.body.samples).toHaveLength(b0!.samples.length);
  });

  it('batches go with their ride (cascade)', async () => {
    const ride = await started();
    const [b0] = recording(ride.id, { seconds: 10 });
    await repo.insert(RideBatch.accept(ride.id, b0!, hashBatch(b0!), T0));
    await prisma.ride.delete({ where: { id: ride.id } });
    expect(await prisma.rideBatch.count()).toBe(0);
  });
});
