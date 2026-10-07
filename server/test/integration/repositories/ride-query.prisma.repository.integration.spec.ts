import { RideQueryPrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride-query.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import type { Ride } from '../../../src/domain/rides/ride.entity.js';
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
  async function ride(wallet: string, opts: { paid?: boolean; metres: number; seconds?: number; hull?: number; route?: string; night?: boolean; outcome?: 'shift' | 'failed' | 'running'; start?: number }) {
    const r: Ride = opts.paid ? orderAt(wallet, at(opts.start ?? 0)) : freeRideAt(wallet, at(opts.start ?? 0));
    if (opts.paid) r.markPaid(1, at(opts.start ?? 0));
    const t0 = opts.start ?? 0, secs = opts.seconds ?? (opts.paid ? 3600 : 10);
    r.start(at(t0));
    r.applyReport({ s: Math.min(opts.metres, 20), t: 1, hull: opts.hull ?? 100, paused: false, route: opts.route ?? null, night: opts.night ?? false }, at(t0 + 1), rules);
    const p = r.snapshot();
    const { Ride: RideClass } = await import('../../../src/domain/rides/ride.entity.js');
    const moved = RideClass.restore({ ...p, lastS: opts.metres, driveSeconds: secs, nightSeconds: opts.night ? secs : 0, lastHbAt: at(t0 + secs), lastT: secs });
    // the QUERY is under test, not the completion rules: set the end state directly
    const ended = opts.outcome === 'shift' ? RideClass.restore({ ...moved.snapshot(), status: 'completed' as never, reason: 'shift complete', endedAt: at(t0 + secs) })
      : opts.outcome === 'failed' ? RideClass.restore({ ...moved.snapshot(), status: 'failed' as never, reason: 'x', endedAt: at(t0 + secs) }) : moved;
    await rides.insert(ended);
    return ended;
  }

  it('live: running rides with a heartbeat since the cut-off, newest start first', async () => {
    await ride('alice', { metres: 50, outcome: 'running', start: 0 });
    await ride('bob', { metres: 70, outcome: 'running', start: 5 });
    await ride('carol', { metres: 10, outcome: 'shift', start: 0 });
    expect((await query.live(at(0), 50)).map((r) => r.wallet)).toEqual(['bob', 'alice']);
    expect((await query.live(at(12), 50)).map((r) => r.wallet)).toEqual(['bob']); // alice's last beat was at 10
    expect(await query.live(at(0), 1)).toHaveLength(1);
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

  it('totals: completed rides only – count, metres and distinct drivers', async () => {
    await ride('alice', { metres: 150, outcome: 'shift', start: 0 });
    await ride('alice', { metres: 140, outcome: 'shift', start: 100 });
    await ride('bob', { metres: 160, outcome: 'shift', start: 200 });
    await ride('carol', { metres: 999, outcome: 'failed', start: 300 });
    expect(await query.totals()).toEqual({ shifts: 3, metres: 450, drivers: 2 });
  });

  it('totals: an empty database is zeros, not null', async () => { expect(await query.totals()).toEqual({ shifts: 0, metres: 0, drivers: 0 }); });

  it('summary: stats and the achievement facts in one read', async () => {
    await ride('alice', { metres: 150, outcome: 'shift', hull: 100, route: 'siberia', night: true });
    await ride('alice', { metres: 60, outcome: 'failed', start: 100 });
    const s = await query.summary('alice');
    expect(s.stats).toEqual({ started: 2, completed: 1, metres: 210, best: 150 });
    expect(s.facts).toEqual({ started: 2, completed: 1, totalMetres: 210, completedAtNight: true, cleanRun: true, completedSiberia: true });
    expect((await query.summary('bob')).stats).toEqual({ started: 0, completed: 0, metres: 0, best: 0 });
  });

  it('recent: started rides only, newest first, limited', async () => {
    await ride('alice', { metres: 1, outcome: 'failed', start: 0 });
    await ride('alice', { metres: 2, outcome: 'failed', start: 50 });
    await rides.insert(freeRideAt('alice')); // never started
    expect((await query.recent('alice', 10)).map((r) => r.lastS)).toEqual([2, 1]);
    expect(await query.recent('alice', 1)).toHaveLength(1);
  });

  it('leaderboard: completed only, total distance, ties → more rides → earlier first finish → wallet; boards separate paid / free / round', async () => {
    await ride('alice', { paid: true, metres: 500, outcome: 'shift', start: 10 });
    await ride('bob', { paid: true, metres: 300, outcome: 'shift', start: 0 });
    await ride('bob', { paid: true, metres: 200, outcome: 'shift', start: 100 }); // bob: 500 over two rides → beats alice's one ride
    await ride('carol', { paid: true, metres: 9999, outcome: 'failed', start: 0 }); // not completed: never ranked
    await ride('carol', { metres: 140, outcome: 'shift', start: 0 }); // free
    expect(await query.leaderboard('round', 1, 20)).toEqual([{ wallet: 'bob', distance: 500, rides: 2 }, { wallet: 'alice', distance: 500, rides: 1 }]);
    expect(await query.leaderboard('round', 2, 20)).toEqual([]);
    expect((await query.leaderboard('all', null, 20)).map((r) => r.wallet)).toEqual(['bob', 'alice']);
    expect(await query.leaderboard('free', null, 20)).toEqual([{ wallet: 'carol', distance: 140, rides: 1 }]);
    expect(await query.leaderboard('all', null, 1)).toHaveLength(1);
  });
});
