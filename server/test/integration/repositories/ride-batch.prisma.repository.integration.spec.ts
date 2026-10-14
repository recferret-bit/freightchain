import { Prisma } from '@prisma/client';
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

  it('the replay columns (clock, switches, inputs) are stored with the samples and read back exactly; gzip makes the input column nearly free', async () => {
    const ride = await started(), other = await started();
    const [replay] = recording(ride.id, { seconds: 15, replay: true }), [plain] = recording(other.id, { seconds: 15 });
    await repo.insert(RideBatch.accept(ride.id, replay!, hashBatch(replay!), at(0)));
    await repo.insert(RideBatch.accept(other.id, plain!, hashBatch(plain!), at(0)));
    expect((await repo.listFrom(ride.id, 0, 10))[0]!.body.samples).toEqual(replay!.samples);
    const size = async (id: string) => (await prisma.rideBatch.findUniqueOrThrow({ where: { rideId_seq: { rideId: id, seq: 0 } } })).payload.byteLength;
    expect((await size(ride.id)) - (await size(other.id))).toBeLessThan(600); // 150 samples × 3 columns, stored gzipped: a few hundred bytes per 15 s batch
  });

  it('a second insert of the same (rideId, seq) is false and leaves the first row untouched', async () => {
    const ride = await started();
    const [b0] = recording(ride.id, { seconds: 10 });
    expect(await repo.insert(RideBatch.accept(ride.id, b0!, hashBatch(b0!), T0))).toBe(true);
    expect(await repo.insert(RideBatch.accept(ride.id, { ...b0!, samples: [] }, 'x', at(5)))).toBe(false);
    expect((await repo.listByRide(ride.id))[0]?.body.samples).toHaveLength(b0!.samples.length);
  });

  it('retention: deletes the batches of rides that ended before the cutoff – except flagged ones and never-judged completed shifts; running rides are never touched', async () => {
    const make = async (endAt: number | null, verdict: 'verified' | 'flagged' | null, completed = false) => {
      const r = freeRideAt('w'); r.start(T0);
      if (endAt !== null) r.finish('failed', 'x', at(endAt));
      await rides.insert(r);
      if (completed) await prisma.ride.update({ where: { id: r.id }, data: { status: 'completed' } });
      for (const b of recording(r.id, { seconds: 20 })) await repo.insert(RideBatch.accept(r.id, b, hashBatch(b), T0));
      if (verdict) await prisma.rideVerdict.create({ data: { rideId: r.id, status: verdict, reasons: [], scores: {}, rulesVersion: 1, judgedAt: T0 } });
      return r.id;
    };
    const old = await make(10, 'verified'), oldUnjudged = await make(10, null), oldFlagged = await make(10, 'flagged'), recent = await make(500, null), running = await make(null, null);
    const oldCompletedUnjudged = await make(10, null, true); // judging failed after /end – JUDGE NOW still needs it
    expect(await repo.deleteForRidesEndedBefore(at(100))).toBe(4);
    const left = async (id: string) => (await repo.listByRide(id)).length;
    expect([await left(old), await left(oldUnjudged), await left(oldFlagged), await left(recent), await left(running), await left(oldCompletedUnjudged)]).toEqual([0, 0, 2, 2, 2, 2]);
  });

  it('listFactsByRide reads the chain columns + the summary without the payload; a row stored WITHOUT a summary (before it existed) is summarised from its payload; totalBytes sums the ride', async () => {
    const ride = await started();
    const bodies = recording(ride.id, { seconds: 30, distance: 420 });
    const accepted = bodies.map((b) => RideBatch.accept(ride.id, b, hashBatch(b), at(b.seq)));
    for (const b of accepted) await repo.insert(b);
    await prisma.rideBatch.update({ where: { rideId_seq: { rideId: ride.id, seq: 1 } }, data: { summary: Prisma.DbNull } }); // an old row
    const facts = await repo.listFactsByRide(ride.id);
    expect(facts.map((f) => f.seq)).toEqual([0, 1]);
    expect(facts[0]).toEqual({ seq: 0, prevHash: ride.id, hash: bodies[0]!.hash, hashOk: true, serverHash: hashBatch(bodies[0]!), t0: 0, t1: 15, summary: accepted[0]!.summary, receivedAt: at(0) });
    expect(facts[1]!.summary).toEqual(accepted[1]!.summary); // measured again from the payload, the same numbers
    expect(facts[1]!.summary.inputs.length).toBeGreaterThan(0);
    expect(await repo.totalBytes(ride.id)).toBe(accepted.reduce((n, b) => n + b.snapshot().bytes, 0));
    expect(await repo.totalBytes('00000000-0000-4000-8000-ffffffffffff')).toBe(0);
  });

  it('the server\'s own hash is stored for every batch – also one the client could not hash (the telemetry_root\'s leaf for it); a row from before has none', async () => {
    const ride = await started();
    const [b0, b1] = recording(ride.id, { seconds: 30 });
    await repo.insert(RideBatch.accept(ride.id, { ...b0!, hash: null }, hashBatch(b0!), at(0)));
    await repo.insert(RideBatch.accept(ride.id, b1!, hashBatch(b1!), at(1)));
    await prisma.rideBatch.update({ where: { rideId_seq: { rideId: ride.id, seq: 1 } }, data: { serverHash: null } }); // stored before the column existed
    const facts = await repo.listFactsByRide(ride.id);
    expect(facts.map((f) => [f.hash, f.serverHash])).toEqual([[null, hashBatch(b0!)], [b1!.hash, null]]);
    expect((await repo.listByRide(ride.id))[0]!.serverHash).toBe(hashBatch(b0!));
  });

  it('listFrom pages the replay by seq; extent is the last seq and the latest game time without inflating', async () => {
    const ride = await started();
    expect(await repo.extent(ride.id)).toEqual({ lastSeq: null, t1: 0 });
    const bodies = recording(ride.id, { seconds: 60 });
    for (const b of bodies) await repo.insert(RideBatch.accept(ride.id, b, hashBatch(b), at(b.seq)));
    expect((await repo.listFrom(ride.id, 1, 2)).map((b) => b.seq)).toEqual([1, 2]);
    expect((await repo.listFrom(ride.id, 3, 10)).map((b) => [b.seq, b.body.samples.length])).toEqual([[3, bodies[3]!.samples.length]]);
    expect(await repo.listFrom(ride.id, 9, 10)).toEqual([]);
    expect(await repo.extent(ride.id)).toEqual({ lastSeq: 3, t1: bodies[3]!.t1 });
  });

  it('batches go with their ride (cascade)', async () => {
    const ride = await started();
    const [b0] = recording(ride.id, { seconds: 10 });
    await repo.insert(RideBatch.accept(ride.id, b0!, hashBatch(b0!), T0));
    await prisma.ride.delete({ where: { id: ride.id } });
    expect(await prisma.rideBatch.count()).toBe(0);
  });
});
