import { AdminQueryPrismaRepository } from '../../../src/infrastructure/prisma/repositories/admin-query.prisma.repository.js';
import { RideBatchPrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride-batch.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import { RideBatch } from '../../../src/domain/telemetry/ride-batch.entity.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, freeRideAt, seedPlayer, testPrisma, wipe } from '../../support/db.js';
import { hashBatch, recording } from '../../support/recording.js';

describe('AdminQueryPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, query: AdminQueryPrismaRepository, rides: RidePrismaRepository, batches: RideBatchPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); query = new AdminQueryPrismaRepository(prisma); rides = new RidePrismaRepository(prisma); batches = new RideBatchPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); for (const w of ['alice', 'bob', 'carol']) await seedPlayer(prisma, w); });

  /** a ride created at `t` s, optionally started / ended, with an optional verdict (`overridden` = decided by an admin) */
  async function ride(wallet: string, t: number, opts: { end?: 'completed' | 'failed'; verdict?: 'verified' | 'flagged' | 'rejected'; overridden?: boolean; batches?: number } = {}) {
    const r = freeRideAt(wallet, at(t));
    r.start(at(t));
    if (opts.end === 'failed') r.finish('failed', 'crash', at(t + 10));
    await rides.insert(r);
    if (opts.end === 'completed') await prisma.ride.update({ where: { id: r.id }, data: { status: 'completed', endedAt: at(t + 10), lastS: 140, driveSeconds: 10 } });
    if (opts.verdict) await prisma.rideVerdict.create({ data: { rideId: r.id, status: opts.verdict, reasons: [], scores: {}, rulesVersion: 1, judgedAt: at(t + 10), overriddenBy: opts.overridden ? 'ADMIN' : null } });
    for (const b of recording(r.id, { seconds: 15 * (opts.batches ?? 0) })) await batches.insert(RideBatch.accept(r.id, b, hashBatch(b), at(t + b.seq)));
    return r.id;
  }

  it('counts: players, rides by status, running, verdicts by status, payments, telemetry rows and bytes', async () => {
    await ride('alice', 0, { end: 'completed', verdict: 'verified', batches: 2 });
    await ride('bob', 1, { end: 'completed', verdict: 'flagged' });
    await ride('carol', 2);
    const c = await query.counts();
    expect(c).toMatchObject({ players: 3, running: 1, rides: { completed: 2, running: 1 }, verdicts: { verified: 1, flagged: 1 }, underReview: 1, payments: { count: 0, lamports: 0 } });
    expect(c.telemetry.batches).toBe(2);
    expect(c.telemetry.bytes).toBeGreaterThan(1000);
  });

  it('rides: newest first; filters by wallet, status, verdict (flagged = the queue, none = unjudged) and limit; an override shows', async () => {
    const a = await ride('alice', 0, { end: 'completed', verdict: 'verified' });
    const b = await ride('bob', 1, { end: 'completed', verdict: 'flagged' });
    const c = await ride('carol', 2, { end: 'failed' });
    const d = await ride('alice', 3, { end: 'completed', verdict: 'verified', overridden: true });
    expect((await query.rides({ limit: 10 })).map((r) => r.id)).toEqual([d, c, b, a]);
    expect((await query.rides({ limit: 10, verdict: 'flagged' })).map((r) => r.id)).toEqual([b]);
    expect((await query.rides({ limit: 10, verdict: 'none' })).map((r) => r.id)).toEqual([c]);
    expect((await query.rides({ limit: 10, wallet: 'alice' })).map((r) => [r.id, r.overridden])).toEqual([[d, true], [a, false]]);
    expect((await query.rides({ limit: 10, status: 'failed' }))[0]).toMatchObject({ id: c, wallet: 'carol', status: 'failed', reason: 'crash', verdict: null, createdAt: at(2), endedAt: at(12) });
    expect(await query.rides({ limit: 2 })).toHaveLength(2);
  });

  /** a completed paid (ticket) ride of pool `poolId` created at `t` s, `metres` long, with an optional verdict */
  async function poolRide(wallet: string, t: number, poolId: number, metres: number, verdict?: 'verified' | 'flagged' | 'rejected', overridden = false) {
    const id = await ride(wallet, t, { end: 'completed', ...(verdict ? { verdict } : {}), overridden });
    await prisma.ride.update({ where: { id }, data: { tier: '1h', poolId, lastS: metres } });
    return id;
  }
  async function pools() {
    const { PoolPrismaRepository } = await import('../../../src/infrastructure/prisma/repositories/pool.prisma.repository.js');
    const { aPool } = await import('../../support/pools.js');
    for (const id of [1, 2]) await new PoolPrismaRepository(prisma).upsert(aPool({ id }, at(0)));
  }

  it('the review queue: completed PAID rides under review (unjudged, flagged, machine-rejected) first, then flagged free rides; counts it; filters by pool', async () => {
    await pools();
    const freeFlagged = await ride('alice', 0, { end: 'completed', verdict: 'flagged' });
    await ride('alice', 1, { end: 'completed', verdict: 'verified' });
    const unjudged = await poolRide('bob', 2, 1, 900);
    const machineRejected = await poolRide('carol', 3, 2, 800, 'rejected');
    const flagged = await poolRide('bob', 4, 1, 700, 'flagged');
    await poolRide('carol', 5, 1, 600, 'verified');
    await poolRide('bob', 6, 1, 500, 'rejected', true);   // an admin's reject: decided
    await poolRide('carol', 7, 2, 400, 'verified', true);
    expect((await query.rides({ limit: 10, review: 'under_review' })).map((r) => [r.id, r.poolId])).toEqual([[flagged, 1], [machineRejected, 2], [unjudged, 1], [freeFlagged, null]]);
    expect((await query.rides({ limit: 2, review: 'under_review' })).map((r) => r.id)).toEqual([flagged, machineRejected]);
    expect((await query.rides({ limit: 10, review: 'under_review', poolId: 1 })).map((r) => r.id)).toEqual([flagged, unjudged]);
    expect((await query.rides({ limit: 10, poolId: 2 })).map((r) => r.poolId)).toEqual([2, 2]);
    expect((await query.counts()).underReview).toBe(4);
  });

  it('poolRides: every completed ride of the pool with its verdict and whether an admin decided it, oldest end first', async () => {
    await pools();
    const a = await poolRide('alice', 0, 1, 900, 'verified');
    const b = await poolRide('bob', 1, 1, 800);
    const c = await poolRide('carol', 2, 1, 700, 'rejected', true);
    await poolRide('carol', 3, 2, 600, 'verified');
    const running = await ride('bob', 4);
    await prisma.ride.update({ where: { id: running }, data: { tier: '1h', poolId: 1 } });
    expect(await query.poolRides(1)).toEqual([
      { rideId: a, wallet: 'alice', distance: 900, driveSeconds: 10, startedAt: at(0), endedAt: at(10), verdict: 'verified', overridden: false },
      { rideId: b, wallet: 'bob', distance: 800, driveSeconds: 10, startedAt: at(1), endedAt: at(11), verdict: null, overridden: false },
      { rideId: c, wallet: 'carol', distance: 700, driveSeconds: 10, startedAt: at(2), endedAt: at(12), verdict: 'rejected', overridden: true },
    ]);
    expect(await query.poolRides(9)).toEqual([]);
  });

  it('batchIndex: seq, span, counts, size, hash check, received time – never the payload', async () => {
    const id = await ride('alice', 0, { end: 'completed', batches: 3 });
    const idx = await query.batchIndex(id);
    expect(idx.map((b) => [b.seq, b.t0, b.t1, b.samples, b.hashOk])).toEqual([[0, 0, 15, 150, true], [1, 15, 30, 150, true], [2, 30, 45, 150, true]]);
    expect(idx[1]?.receivedAt).toBe(at(1).getTime());
    expect(Object.keys(idx[0] ?? {})).not.toContain('payload');
    expect(await query.batchIndex('00000000-0000-4000-8000-ffffffffffff')).toEqual([]);
    expect(T0).toBeDefined();
  });
});
