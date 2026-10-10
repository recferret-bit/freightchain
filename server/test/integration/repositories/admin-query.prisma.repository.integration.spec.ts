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
    expect(c).toMatchObject({ players: 3, running: 1, rides: { completed: 2, running: 1 }, verdicts: { verified: 1, flagged: 1 }, payments: { count: 0, lamports: 0 } });
    expect(c.telemetry.batches).toBe(2);
    expect(c.telemetry.bytes).toBeGreaterThan(1000);
  });

  it('flaggedCount: only verdicts waiting for a decision', async () => {
    await ride('alice', 0, { end: 'completed', verdict: 'verified' });
    expect(await query.flaggedCount()).toBe(0);
    await ride('bob', 1, { end: 'completed', verdict: 'flagged' });
    await ride('carol', 2, { end: 'completed', verdict: 'rejected' });
    await ride('alice', 3, { end: 'completed', verdict: 'flagged' });
    expect(await query.flaggedCount()).toBe(2);
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
