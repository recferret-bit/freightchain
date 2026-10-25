import { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { RideVerdict } from '../../../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { FINISHED_LIMIT } from '../../../../../src/domain/lobby/lobby.dto.js';
import { GetLiveHandler } from '../../../../../src/application/use-cases/lobby/get-live/get-live.handler.js';
import { GetLiveQuery } from '../../../../../src/application/use-cases/lobby/get-live/get-live.query.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetLiveHandler', () => {
  const paidRide = async (ctx: ReturnType<typeof unitContext>, wallet: string) => {
    const r = await ctx.paidOrder(wallet);
    r.markPaid(1, ctx.now());
    r.start(ctx.now());
    return ctx.rides.save(r);
  };

  it('a recent paid heartbeat counts as driving; the public board has no ride cards (RPL-M-11)', async () => {
    const ctx = unitContext();
    const first = await paidRide(ctx, 'alice');
    ctx.clock.advance(1);
    await paidRide(ctx, 'bob');
    ctx.clock.advance(4);
    first.applyReport({ s: 70, t: 5, hull: 80, paused: true, night: false }, ctx.now(), ctx.rules.get());
    await ctx.rides.save(first);
    await ctx.freeRide('carol', true); // free ride: not on the live board
    const feed = await new GetLiveHandler(ctx.rideQuery, ctx.rules, ctx.clock, ctx.sitePresence, ctx.viewers, ctx.stats).execute();
    expect(feed.now).toBe(ctx.clock.ms);
    expect(feed.rides).toEqual([]);
    expect(feed.online.driving).toBe(2);
  });

  it('drops a ride whose heartbeats stopped longer than the timeout ago', async () => {
    const ctx = unitContext();
    const handler = new GetLiveHandler(ctx.rideQuery, ctx.rules, ctx.clock, ctx.sitePresence, ctx.viewers, ctx.stats);
    await paidRide(ctx, 'alice');
    expect((await handler.execute()).online.driving).toBe(1);
    ctx.clock.advance(151);
    const later = await handler.execute();
    expect(later.online.driving).toBe(0);
    expect(later.rides).toEqual([]);
  });

  const feed = (ctx: ReturnType<typeof unitContext>) => new GetLiveHandler(ctx.rideQuery, ctx.rules, ctx.clock, ctx.sitePresence, ctx.viewers, ctx.stats).execute();

  it('next up: paid shifts that have not started, as wallet + tier + length + paid time – no ride id', async () => {
    const ctx = unitContext();
    const paid = await ctx.paidOrder('alice');
    paid.markPaid(1, ctx.now()); await ctx.rides.save(paid);
    await ctx.paidOrder('bob');            // ordered, never paid
    await ctx.freeRide('carol');           // free rides never queue
    const { upcoming } = await feed(ctx);
    expect(upcoming).toEqual([{ wallet: 'alice', tier: '1h', minSeconds: 3600, paidAt: ctx.clock.ms }]);
  });

  it('recent finishes: public 1h rides, newest first, without reasons; a free ride stays off the board', async () => {
    const ctx = unitContext();
    const end = async (wallet: string, metres: number) => {
      const r = await ctx.paidRide(wallet); ctx.clock.advance(2);
      r.applyReport({ s: metres, t: 1, hull: 100, paused: false, night: false }, ctx.now(), ctx.rules.get()); r.finish('failed', 'x', ctx.now()); await ctx.rides.save(r);
    };
    const carol = await ctx.freeRide('carol', true); ctx.clock.advance(2);
    carol.applyReport({ s: 3, t: 1, hull: 100, paused: false, night: false }, ctx.now(), ctx.rules.get()); carol.finish('failed', 'x', ctx.now()); await ctx.rides.save(carol);
    await end('alice', 12.4); ctx.clock.advance(5); await end('bob', 7);
    const { recent } = await feed(ctx);
    expect(recent.map((r) => [r.wallet, r.status, r.distance])).toEqual([['bob', 'failed', 7], ['alice', 'failed', 12]]);
    expect(recent.some((r) => r.wallet === 'carol')).toBe(false);
    expect(Object.keys(recent[0] ?? {}).sort()).toEqual(['distance', 'endedAt', 'id', 'route', 'status', 'tier', 'wallet']);
  });

  it('applies public replay visibility before the ticker limit, even to the signed-in owner', async () => {
    const ctx = unitContext();
    const visible = await ctx.paidRide('public', true);
    visible.finish('failed', 'x', ctx.now()); await ctx.rides.save(visible);
    for (let i = 0; i < FINISHED_LIMIT + 1; i++) {
      ctx.clock.advance(1);
      const r = await ctx.freeRide(`training-${i}`, true);
      r.finish('failed', 'x', ctx.now()); await ctx.rides.save(r);
    }
    for (const kind of ['rejected', 'tutorial', 'assist', 'locked'] as const) {
      const r = await ctx.paidRide(kind, true); ctx.clock.advance(1);
      r.finish('failed', 'x', ctx.now());
      await ctx.rides.save(Ride.restore({ ...r.snapshot(), tutorial: kind === 'tutorial', assist: kind === 'assist', poolId: kind === 'locked' ? 42 : null }));
      if (kind === 'rejected') await ctx.verdictRepo.save(RideVerdict.restore({ rideId: r.id, status: VerdictStatus.Rejected, reasons: [], scores: {} as never, rulesVersion: 1, judgedAt: ctx.now(), version: 1 }));
    }
    const handler = new GetLiveHandler(ctx.rideQuery, ctx.rules, ctx.clock, ctx.sitePresence, ctx.viewers, ctx.stats);
    const result = await handler.execute(new GetLiveQuery('owner-visitor', 'lobby', '127.0.0.1', 'locked'));
    expect(result.recent.map(r => r.id)).toEqual([visible.id]);
  });

  it('who is online: the polling page counts (≤ 3 ids per address), signed-in wallets and drivers are players, watchers from the watch pages', async () => {
    const ctx = unitContext();
    const handler = new GetLiveHandler(ctx.rideQuery, ctx.rules, ctx.clock, ctx.sitePresence, ctx.viewers, ctx.stats);
    const ride = await paidRide(ctx, 'driver');
    ctx.viewers.seen(ride.id, '10.0.0.9', 'watcher-1', ctx.now()); // counted in online.watching; the card itself is not on the public board
    await handler.execute(new GetLiveQuery('visitor-aaaa', 'landing', '10.0.0.1', null));
    for (let i = 0; i < 6; i++) await handler.execute(new GetLiveQuery(`bot-${i}-xxxxxx`, 'lobby', '10.0.0.2', null));
    const feed = await handler.execute(new GetLiveQuery('visitor-bbbb', 'lobby', '10.0.0.3', 'fan'));
    expect(feed.online).toEqual({ total: 1 + 3 + 1 + 1 + 1, browsing: 5, watching: 1, driving: 1, players: 2 });
    expect(feed.rides).toEqual([]); // RPL-M-11: viewers and signal stay off the public cards
    ctx.clock.advance(31);   // the visitors' window (30 s) passed; the ride beat 31 s ago
    const later = await handler.execute(new GetLiveQuery());
    expect(later.online).toMatchObject({ browsing: 0, driving: 1 });
    ctx.clock.advance(15);
    expect((await handler.execute(new GetLiveQuery())).online.driving).toBe(1);   // 46 s without a heartbeat is still inside the 150 s timeout
  });

  it('a closing page (leave) stops counting at once', async () => {
    const ctx = unitContext();
    const handler = new GetLiveHandler(ctx.rideQuery, ctx.rules, ctx.clock, ctx.sitePresence, ctx.viewers, ctx.stats);
    await handler.execute(new GetLiveQuery('visitor-aaaa', 'lobby', '10.0.0.1', 'W'));
    expect((await handler.execute(new GetLiveQuery())).online.browsing).toBe(1);
    expect((await handler.execute(new GetLiveQuery('visitor-aaaa', 'lobby', '10.0.0.1', 'W', true))).online).toMatchObject({ browsing: 0, players: 0 });
  });

  it('totals: zeros on an empty feed', async () => {
    expect(await feed(unitContext())).toMatchObject({ rides: [], upcoming: [], recent: [], totals: { shifts: 0, metres: 0, drivers: 0 } });
  });

  it('totals come from the statistics: every ended ride counts (not only complete shifts), plus time, crashes and donations', async () => {
    const ctx = unitContext();
    expect((await feed(ctx)).totals).toEqual({ shifts: 0, rides: 0, ridesFree: 0, ridesPaid: 0, metres: 0, seconds: 0, drivers: 0, crashes: 0, donations: 0 });
    const ride = await ctx.freeRide('alice', true);
    ctx.clock.advance(4);
    ride.applyReport({ s: 55, t: 4, hull: 90, paused: false, night: false, crashesVehicle: 2, crashesBuilding: 1 }, ctx.now(), ctx.rules.get());
    ride.finish('failed', 'crash', ctx.now());
    await ctx.rides.save(ride);
    await ctx.stats.recordRide(ride.snapshot());
    await ctx.stats.recordDonation('alice', 0, false);
    expect((await feed(ctx)).totals).toEqual({ shifts: 0, rides: 1, ridesFree: 1, ridesPaid: 0, metres: 55, seconds: 4, drivers: 1, crashes: 3, donations: 1 });
  });
});
