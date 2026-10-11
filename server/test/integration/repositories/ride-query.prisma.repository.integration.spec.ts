import { RideQueryPrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride-query.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import type { Ride } from '../../../src/domain/rides/ride.entity.js';
import type { FreeLevel } from '../../../src/domain/rides/ride-trip.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { at, freeRideAt, orderAt, seedPlayer, testPrisma, wipe } from '../../support/db.js';

const rules = { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 };

describe('RideQueryPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, query: RideQueryPrismaRepository, rides: RidePrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); query = new RideQueryPrismaRepository(prisma); rides = new RidePrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await wipe(prisma);
    for (const w of ['alice', 'bob', 'carol']) await seedPlayer(prisma, w);
    await prisma.round.create({ data: { id: 1, startsAt: at(-1000), endsAt: at(1_000_000), carry: 0n, status: 'open' } });
  });

  /** drive a ride to an end state at t seconds: `metres` along, given flags */
  async function ride(wallet: string, opts: { paid?: boolean; metres: number; seconds?: number; hull?: number; route?: string; night?: boolean; assist?: boolean; level?: FreeLevel; trip?: string | null; outcome?: 'shift' | 'failed' | 'running'; start?: number; verdict?: 'verified' | 'flagged' | 'rejected' | null }) {
    const r: Ride = opts.paid ? orderAt(wallet, at(opts.start ?? 0)) : freeRideAt(wallet, at(opts.start ?? 0), 10, { assist: opts.assist, level: opts.level });
    if (opts.paid) r.markPaid(1, at(opts.start ?? 0));
    const t0 = opts.start ?? 0, secs = opts.seconds ?? (opts.paid ? 3600 : 10);
    r.start(at(t0));
    r.applyReport({ s: Math.min(opts.metres, 20), t: 1, hull: opts.hull ?? 100, paused: false, night: opts.night ?? false }, at(t0 + 1), rules);
    const p = r.snapshot();
    const { Ride: RideClass } = await import('../../../src/domain/rides/ride.entity.js');
    const moved = RideClass.restore({ ...p, ...(opts.trip !== undefined ? { trip: opts.trip } : {}), route: opts.route ?? null, lastS: opts.metres, driveSeconds: secs, nightSeconds: opts.night ? secs : 0, lastHbAt: at(t0 + secs), lastT: secs });
    // the QUERY is under test, not the completion rules: set the end state directly
    const ended = opts.outcome === 'shift' ? RideClass.restore({ ...moved.snapshot(), status: 'completed' as never, reason: 'shift complete', endedAt: at(t0 + secs) })
      : opts.outcome === 'failed' ? RideClass.restore({ ...moved.snapshot(), status: 'failed' as never, reason: 'x', endedAt: at(t0 + secs) }) : moved;
    await rides.insert(ended);
    const verdict = opts.verdict === undefined ? (opts.outcome === 'shift' ? 'verified' : null) : opts.verdict;
    if (verdict) await prisma.rideVerdict.create({ data: { rideId: ended.id, status: verdict, reasons: [], scores: {}, rulesVersion: 1, judgedAt: at(t0 + secs) } });
    return ended;
  }

  /** the distance page, ranks included — the old `limit` is the page size and the cap is the lobby's 100 */
  const top = async (board: 'round' | 'all' | 'free', roundId: number | null, limit: number, verified: boolean, trip: string | null) =>
    (await query.leaderboard(board, roundId, verified, trip, null, 'distance', 0, limit, 100)).rows;

  it('live: running rides with a heartbeat since the cut-off, newest start first; free rides excluded', async () => {
    await ride('alice', { paid: true, seconds: 10, metres: 50, outcome: 'running', start: 0 });
    await ride('bob', { paid: true, seconds: 10, metres: 70, outcome: 'running', start: 5 });
    await ride('carol', { paid: true, seconds: 10, metres: 10, outcome: 'shift', start: 0 });
    await ride('carol', { metres: 30, outcome: 'running', start: 1 }); // free ride: excluded
    expect((await query.live(at(0), 50)).map((r) => r.wallet)).toEqual(['bob', 'alice']);
    expect((await query.live(at(12), 50)).map((r) => r.wallet)).toEqual(['bob']); // alice's last beat was at 10
    expect(await query.live(at(0), 1)).toHaveLength(1);
  });

  it('staleRunning: running rides whose last heartbeat is older than the cut-off, oldest first – never ended or fresh ones', async () => {
    const a = await ride('alice', { metres: 50, outcome: 'running', start: 0 });     // last beat at 10
    const b = await ride('bob', { metres: 70, outcome: 'running', start: 20 });      // last beat at 30
    await ride('carol', { metres: 10, outcome: 'failed', start: 0 });
    expect(await query.staleRunning(at(20), 50)).toEqual([{ id: a.id, wallet: 'alice' }]);
    expect((await query.staleRunning(at(100), 50)).map((r) => r.id)).toEqual([a.id, b.id]);
    expect(await query.staleRunning(at(100), 1)).toHaveLength(1);
  });

  it('history: ended rides newest end first, a stable (endedAt, seq) cursor, wallet / status filters, and whether a recording is kept – in one query', async () => {
    const a = await ride('alice', { metres: 50, outcome: 'shift', start: 0 });        // ended at 10
    const b = await ride('bob', { metres: 70, outcome: 'failed', start: 0 });         // ended at 10 too: the seq breaks the tie
    const c = await ride('carol', { metres: 10, outcome: 'failed', start: 20 });      // ended at 30
    await ride('alice', { metres: 5, outcome: 'running', start: 40 });
    await prisma.rideBatch.create({ data: { rideId: a.id, seq: 0, prevHash: a.id, hash: null, hashOk: false, t0: 0, t1: 1, samples: 0, inputs: 0, bytes: 2, payload: Buffer.from([0x1f, 0x8b]), receivedAt: at(1) } });
    const all = await query.history({ before: null, limit: 10, wallet: null, status: null });
    expect(all.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    expect(all.map((r) => r.recorded)).toEqual([false, false, true]);
    const second = await query.history({ before: { endedAt: all[1]!.endedAt, seq: all[1]!.seq }, limit: 10, wallet: null, status: null });
    expect(second.map((r) => r.id)).toEqual([a.id]);   // same endedAt as b, an older seq
    expect((await query.history({ before: null, limit: 10, wallet: 'alice', status: null })).map((r) => r.id)).toEqual([a.id]);
    expect((await query.history({ before: null, limit: 10, wallet: null, status: 'failed' })).map((r) => r.id)).toEqual([c.id, b.id]);
    expect(await query.history({ before: null, limit: 1, wallet: null, status: null })).toHaveLength(1);
  });

  it('upcoming: only paid, not-yet-started shifts, most recently paid first – free and started rides never queue', async () => {
    const a = orderAt('alice', at(0)); a.markPaid(1, at(10)); await rides.insert(a);
    const b = orderAt('bob', at(5)); b.markPaid(1, at(20)); await rides.insert(b);
    await rides.insert(orderAt('carol', at(30)));                  // ordered, not paid
    await rides.insert(freeRideAt('carol', at(40)));               // free
    await ride('carol', { paid: true, metres: 10, outcome: 'running', start: 50 });   // paid and already driving
    expect((await query.upcoming(10)).map((r) => [r.wallet, r.tier, r.minSeconds])).toEqual([['bob', '1h', 3600], ['alice', '1h', 3600]]);
    expect(await query.upcoming(1)).toHaveLength(1);
  });

  it('finished: started rides that ended (any outcome), latest end first – never running, created or unstarted ones', async () => {
    await ride('alice', { metres: 150, outcome: 'shift', route: 'siberia', start: 0 });   // ends at 10
    await ride('bob', { metres: 60, outcome: 'failed', start: 100 });                    // ends at 110
    await ride('carol', { metres: 20, outcome: 'running', start: 200 });
    await rides.insert(freeRideAt('carol', at(300)));                                    // created only
    const rows = await query.finished(10);
    expect(rows.map((r) => [r.wallet, r.status, r.lastS, r.route])).toEqual([['bob', 'failed', 60, null], ['alice', 'completed', 150, 'siberia']]);
    expect(await query.finished(1)).toHaveLength(1);
  });

  it('summary: "unassisted" needs a COMPLETED FREE ride driven without assist – an assisted one, a failed one and a paid one do not count', async () => {
    await ride('alice', { metres: 150, outcome: 'shift', assist: true });
    await ride('alice', { metres: 60, outcome: 'failed', start: 100 });
    await ride('bob', { metres: 150, outcome: 'shift', paid: true });
    expect((await query.summary('alice')).facts.completedFreeUnassisted).toBe(false);
    expect((await query.summary('bob')).facts.completedFreeUnassisted).toBe(false);
    await ride('alice', { metres: 150, outcome: 'shift', start: 200 });
    expect((await query.summary('alice')).facts.completedFreeUnassisted).toBe(true);
  });

  it('summary: the free LEVELS cleared come from the trips of COMPLETED free rides – each once, ascending; a failed one, a paid one and an old "free" trip clear none', async () => {
    await ride('alice', { metres: 150, outcome: 'shift', level: 3 });
    await ride('alice', { metres: 60, outcome: 'failed', start: 100, level: 2 });
    await ride('alice', { metres: 150, outcome: 'shift', start: 200, level: 3 });
    await ride('alice', { metres: 150, outcome: 'shift', start: 300, trip: 'free' });   // a free ride from before the levels
    await ride('bob', { metres: 150, outcome: 'shift', paid: true });
    expect((await query.summary('alice')).facts.completedFreeLevels).toEqual([3]);
    expect((await query.summary('bob')).facts.completedFreeLevels).toEqual([]);
    await ride('alice', { metres: 150, outcome: 'shift', start: 400, level: 1 });
    expect((await query.summary('alice')).facts.completedFreeLevels).toEqual([1, 3]);
  });

  it('summary: stats and the achievement facts in one read', async () => {
    await ride('alice', { metres: 150, outcome: 'shift', hull: 100, route: 'siberia', night: true });
    await ride('alice', { metres: 60, outcome: 'failed', start: 100 });
    const s = await query.summary('alice');
    expect(s.stats).toEqual({ started: 2, completed: 1, metres: 210, best: 150 });
    expect(s.facts).toEqual({ started: 2, completed: 1, totalMetres: 210, completedAtNight: true, cleanRun: true, completedSiberia: true, completedFreeUnassisted: true, completedFreeLevels: [1] });
    expect((await query.summary('bob')).stats).toEqual({ started: 0, completed: 0, metres: 0, best: 0 });
  });

  it('summary skipRejected (VERDICT_ENFORCE): a ride the verdict rejected earns no completion and its metres do not count (its start does); the stats still count it', async () => {
    await ride('alice', { metres: 150, outcome: 'shift', hull: 100, route: 'siberia', night: true, verdict: 'rejected' });
    await ride('alice', { metres: 40, outcome: 'shift', start: 100, verdict: 'verified' });
    await ride('alice', { metres: 60, outcome: 'failed', start: 200 });
    const s = await query.summary('alice', { skipRejected: true });
    expect(s.stats).toEqual({ started: 3, completed: 2, metres: 250, best: 150 });
    expect(s.facts).toEqual({ started: 3, completed: 1, totalMetres: 100, completedAtNight: false, cleanRun: true, completedSiberia: false, completedFreeUnassisted: true, completedFreeLevels: [1] });
    expect((await query.summary('alice')).facts).toMatchObject({ started: 3, completed: 2, totalMetres: 250, completedSiberia: true });   // shadow mode: every ride counts
    await prisma.rideVerdict.updateMany({ where: { status: 'rejected' }, data: { reasons: [{ code: 'no-recording' }] } });   // rejected only for having no recording: not a cheat, it counts
    expect((await query.summary('alice', { skipRejected: true })).facts).toMatchObject({ started: 3, completed: 2, totalMetres: 250 });
  });

  it('recent: started rides only, newest first, limited', async () => {
    await ride('alice', { metres: 1, outcome: 'failed', start: 0 });
    await ride('alice', { metres: 2, outcome: 'failed', start: 50 });
    await rides.insert(freeRideAt('alice')); // never started
    expect((await query.recent('alice', 10)).map((r) => r.lastS)).toEqual([2, 1]);
    expect(await query.recent('alice', 1)).toHaveLength(1);
  });

  it('forRejudge: completed shifts by their verdict (or none), since a time, oldest end first, limited', async () => {
    const a = await ride('alice', { metres: 140, outcome: 'shift', verdict: 'verified' });
    const b = await ride('bob', { metres: 140, outcome: 'shift', start: 100, verdict: 'flagged' });
    const c = await ride('carol', { metres: 140, outcome: 'shift', start: 200, verdict: null });
    await ride('alice', { metres: 140, outcome: 'failed', start: 300, verdict: null });
    await ride('bob', { metres: 50, outcome: 'running', start: 400 });
    const ids = async (f: Parameters<typeof query.forRejudge>[0]) => (await query.forRejudge(f)).map((r) => [r.id, r.verdict]);
    expect(await ids({ verdict: 'all', since: null, limit: 10 })).toEqual([[a.id, 'verified'], [b.id, 'flagged'], [c.id, null]]);
    expect(await ids({ verdict: 'unjudged', since: null, limit: 10 })).toEqual([[c.id, null]]);
    expect(await ids({ verdict: 'flagged', since: null, limit: 10 })).toEqual([[b.id, 'flagged']]);
    expect(await ids({ verdict: 'rejected', since: null, limit: 10 })).toEqual([]);
    expect(await ids({ verdict: 'all', since: at(150), limit: 10 })).toEqual([[c.id, null]]);
    expect(await ids({ verdict: 'all', since: null, limit: 2 })).toEqual([[a.id, 'verified'], [b.id, 'flagged']]);
  });

  it('leaderboard: completed only, total distance, ties → more rides → earlier first finish → wallet; boards separate paid / free / round', async () => {
    await ride('alice', { paid: true, metres: 500, outcome: 'shift', start: 10 });
    await ride('bob', { paid: true, metres: 300, outcome: 'shift', start: 0 });
    await ride('bob', { paid: true, metres: 200, outcome: 'shift', start: 100 }); // bob: 500 over two rides → beats alice's one ride
    await ride('carol', { paid: true, metres: 9999, outcome: 'failed', start: 0 }); // not completed: never ranked
    await ride('carol', { metres: 140, outcome: 'shift', start: 0 }); // free
    expect(await top('round', 1, 20, true, null)).toEqual([{ rank: 1, wallet: 'bob', distance: 500, seconds: 7200, hull: 100, rides: 2 }, { rank: 2, wallet: 'alice', distance: 500, seconds: 3600, hull: 100, rides: 1 }]);
    expect(await top('round', 2, 20, true, null)).toEqual([]);
    expect((await top('all', null, 20, true, null)).map((r) => r.wallet)).toEqual(['bob', 'alice']);
    expect(await top('free', null, 20, true, 'free-1b')).toEqual([{ rank: 1, wallet: 'carol', distance: 140, seconds: 10, hull: 100, rides: 1 }]);
    expect(await top('all', null, 1, true, null)).toHaveLength(1);
  });

  it('leaderboard: the free board ranks ONE level – only completed free rides on that trip; the old free trip and classic rank on none', async () => {
    await ride('alice', { level: 3, metres: 6700, outcome: 'shift' });
    await ride('bob', { level: 1, metres: 420, outcome: 'shift' });
    await ride('bob', { level: 1, metres: 430, outcome: 'shift', start: 100 });
    await ride('carol', { level: 2, metres: 1500, outcome: 'shift' });
    await ride('carol', { metres: 9000, outcome: 'shift', start: 200, trip: 'free' }); // the one free trip before the levels
    await ride('carol', { metres: 9000, outcome: 'shift', start: 300, trip: null }); // classic
    await ride('alice', { level: 1, metres: 9000, outcome: 'failed', start: 400 }); // not completed
    expect(await top('free', null, 20, true, 'free-1b')).toEqual([{ rank: 1, wallet: 'bob', distance: 850, seconds: 20, hull: 100, rides: 2 }]);
    expect(await top('free', null, 20, true, 'free-2b')).toEqual([{ rank: 1, wallet: 'carol', distance: 1500, seconds: 10, hull: 100, rides: 1 }]);
    expect(await top('free', null, 20, true, 'free-3b')).toEqual([{ rank: 1, wallet: 'alice', distance: 6700, seconds: 10, hull: 100, rides: 1 }]);
    expect(await top('free', null, 20, true, null)).toEqual([]);
  });

  it('leaderboard: the paid boards join the verdict – flagged, rejected or unjudged shifts do not rank; free rides rank whatever their verdict', async () => {
    await ride('alice', { paid: true, metres: 500, outcome: 'shift', verdict: 'verified' });
    await ride('bob', { paid: true, metres: 900, outcome: 'shift', verdict: 'flagged' });
    await ride('carol', { paid: true, metres: 800, outcome: 'shift', verdict: null });
    await ride('carol', { metres: 140, outcome: 'shift', verdict: 'rejected' });
    expect((await top('round', 1, 20, true, null)).map((r) => r.wallet)).toEqual(['alice']);
    expect((await top('all', null, 20, true, null)).map((r) => r.wallet)).toEqual(['alice']);
    expect((await top('free', null, 20, true, 'free-1b')).map((r) => r.wallet)).toEqual(['carol']);
    expect((await top('round', 1, 20, false, null)).map((r) => r.wallet)).toEqual(['bob', 'carol', 'alice']); // shadow mode: verdicts ignored
    expect((await query.recent('bob', 5))[0]?.verdict).toBe('flagged');
    const carol = await query.recent('carol', 5);
    expect(carol).toHaveLength(2);
    expect(carol.map((r) => r.verdict)).toEqual(expect.arrayContaining(['rejected', null])); // the free ride's verdict, the unjudged paid one
    expect((await query.recent('bob', 5))[0]?.overridden).toBe(false);
    await prisma.rideVerdict.updateMany({ where: { ride: { wallet: 'bob' } }, data: { status: 'rejected', overriddenBy: 'ADMIN', overriddenAt: at(5000) } });
    expect((await query.recent('bob', 5))[0]).toMatchObject({ verdict: 'rejected', overridden: true });   // an admin's reject: the review says REJECTED, not UNDER REVIEW
  });

  it('poolRanking: the same ranking over the completed rides of one pool only', async () => {
    const { PoolPrismaRepository } = await import('../../../src/infrastructure/prisma/repositories/pool.prisma.repository.js');
    const { aPool } = await import('../../support/pools.js');
    const pools = new PoolPrismaRepository(prisma);
    for (const id of [1, 2]) await pools.upsert(aPool({ id }, at(0)));
    const inPool = async (poolId: number, wallet: string, metres: number, outcome: 'shift' | 'failed' = 'shift') => {
      const r = await ride(wallet, { paid: true, metres, outcome });
      await prisma.ride.update({ where: { id: r.id }, data: { poolId } });
    };
    await inPool(1, 'alice', 300); await inPool(1, 'bob', 200); await inPool(1, 'bob', 200); await inPool(1, 'carol', 900, 'failed'); await inPool(2, 'carol', 1000);
    await ride('carol', { paid: true, metres: 5000, outcome: 'shift' }); // a paid ride of no pool
    expect(await query.poolRanking(1, 20, false)).toEqual([{ wallet: 'bob', distance: 400, seconds: 7200, hull: 100, rides: 2 }, { wallet: 'alice', distance: 300, seconds: 3600, hull: 100, rides: 1 }]);
    expect(await query.poolRanking(2, 20, false)).toEqual([{ wallet: 'carol', distance: 1000, seconds: 3600, hull: 100, rides: 1 }]);
    expect(await query.poolRanking(1, 1, false)).toHaveLength(1);
  });

  it('poolUnreviewed: the completed rides of one pool with no verdict or a machine verdict that is not verified and no admin decision', async () => {
    const { PoolPrismaRepository } = await import('../../../src/infrastructure/prisma/repositories/pool.prisma.repository.js');
    const { aPool } = await import('../../support/pools.js');
    const pools = new PoolPrismaRepository(prisma);
    for (const id of [1, 2]) await pools.upsert(aPool({ id }, at(0)));
    for (const w of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) await seedPlayer(prisma, w);
    const inPool = async (poolId: number, wallet: string, verdict: 'verified' | 'flagged' | 'rejected' | null, outcome: 'shift' | 'failed' = 'shift') => {
      const r = await ride(wallet, { paid: true, metres: 100, outcome, verdict });
      await prisma.ride.update({ where: { id: r.id }, data: { poolId } });
      return r.id;
    };
    const ok = await inPool(1, 'a', 'verified');
    const flagged = await inPool(1, 'b', 'flagged');
    const rejected = await inPool(1, 'c', 'rejected');
    const unjudged = await inPool(1, 'd', null);
    const decided = await inPool(1, 'e', 'rejected');
    await prisma.rideVerdict.update({ where: { rideId: decided }, data: { overriddenBy: 'Admin', overriddenAt: at(5) } });
    await inPool(1, 'f', null, 'failed'); // not completed: nothing to review
    await inPool(2, 'g', 'flagged'); // another pool
    const rows = await query.poolUnreviewed(1, 50);
    expect(rows.map((r) => r.id).sort()).toEqual([flagged, rejected, unjudged].sort());
    expect(rows.find((r) => r.id === unjudged)).toEqual({ id: unjudged, wallet: 'd', verdict: null });
    expect(rows.some((r) => r.id === ok || r.id === decided)).toBe(false);
    expect(await query.poolUnreviewed(1, 1)).toHaveLength(1);
  });

  it('leaderboard: time, hull and shifts re-order the same totals; hull is the furthest shift, not the best; a page past the cap is empty', async () => {
    await ride('alice', { paid: true, metres: 1000, hull: 10, seconds: 100, outcome: 'shift' });          // the furthest: hull 10 counts, not the 99 below
    await ride('alice', { paid: true, metres: 100, hull: 99, seconds: 50, outcome: 'shift', start: 10 });
    await ride('bob', { paid: true, metres: 400, hull: 80, seconds: 500, outcome: 'shift' });
    await ride('carol', { paid: true, metres: 5000, hull: 0, seconds: 10, outcome: 'shift' });             // 0 hull still ranks; a missing one would sort last
    const order = async (sort: 'distance' | 'time' | 'hull' | 'rides') => (await query.leaderboard('all', null, false, null, null, sort, 0, 25, 100)).rows.map((r) => r.wallet);
    expect(await order('distance')).toEqual(['carol', 'alice', 'bob']);
    expect(await order('time')).toEqual(['bob', 'alice', 'carol']);   // 500, 150, 10
    expect(await order('hull')).toEqual(['bob', 'alice', 'carol']);   // 80, 10 (the 1000 m shift, not its 99), 0
    expect(await order('rides')).toEqual(['alice', 'carol', 'bob']);  // 2, then carol's 5000 m beats bob's 400
    expect(await query.leaderboardPlace('all', null, false, null, null, 'alice', 'hull')).toMatchObject({ rank: 2, distance: 1100, seconds: 150, hull: 10, rides: 2 });
    expect(await query.leaderboardPlace('all', null, false, null, null, 'nobody', 'distance')).toBeNull();
    const page = await query.leaderboard('all', null, false, null, null, 'distance', 1, 1, 100);
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r.wallet)).toEqual(['alice']);
    expect(page.rows[0]?.rank).toBe(2);
    expect(await query.leaderboard('all', null, false, null, null, 'distance', 100, 25, 100)).toEqual({ rows: [], total: 3 });
  });
});
