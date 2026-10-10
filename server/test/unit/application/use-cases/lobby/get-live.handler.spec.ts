import { GetLiveHandler } from '../../../../../src/application/use-cases/lobby/get-live/get-live.handler.js';
import { GetLiveQuery } from '../../../../../src/application/use-cases/lobby/get-live/get-live.query.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetLiveHandler', () => {
  it('running rides with a recent heartbeat, newest first, with the ride id (the watch link) but no seed or reason', async () => {
    const ctx = unitContext();
    const first = await ctx.freeRide('alice', true);
    ctx.clock.advance(1);
    await ctx.freeRide('bob', true);
    ctx.clock.advance(4);
    first.applyReport({ s: 70, t: 5, hull: 80, paused: true, night: false }, ctx.now(), ctx.rules.get());
    await ctx.rides.save(first);
    await ctx.freeRide('carol'); // not started
    const feed = await new GetLiveHandler(ctx.rideQuery, ctx.rules, ctx.clock, ctx.sitePresence, ctx.viewers, ctx.stats).execute();
    expect(feed.now).toBe(ctx.clock.ms);
    expect(feed.rides.map((r) => r.wallet)).toEqual(['bob', 'alice']);
    expect(feed.rides[1]).toMatchObject({ tier: 'free', route: 'siberia', paused: true, hull: 80, distance: 70, driveSeconds: 5, minSeconds: 10, completeDist: 70, sinceBeat: 0, progress: 0.5 });
    expect(feed.rides[1]?.id).toBe(first.id);
    expect(Object.keys(feed.rides[1] ?? {})).not.toContain('seed'); expect(Object.keys(feed.rides[1] ?? {})).not.toContain('reason');
  });

  it('drops a ride whose heartbeats stopped longer than the timeout ago', async () => {
    const ctx = unitContext();
    await ctx.freeRide('alice', true);
    ctx.clock.advance(151);
    expect((await new GetLiveHandler(ctx.rideQuery, ctx.rules, ctx.clock, ctx.sitePresence, ctx.viewers, ctx.stats).execute()).rides).toEqual([]);
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

  it('recent finishes: outcome, rounded distance and the id (the replay link) of rides that ended, newest first, without reasons', async () => {
    const ctx = unitContext();
    const end = async (wallet: string, metres: number) => {
      const r = await ctx.freeRide(wallet, true); ctx.clock.advance(2);
      r.applyReport({ s: metres, t: 1, hull: 100, paused: false, night: false }, ctx.now(), ctx.rules.get()); r.finish('failed', 'x', ctx.now()); await ctx.rides.save(r);
    };
    await end('alice', 12.4); ctx.clock.advance(5); await end('bob', 7);
    const { recent } = await feed(ctx);
    expect(recent.map((r) => [r.wallet, r.status, r.distance])).toEqual([['bob', 'failed', 7], ['alice', 'failed', 12]]);
    expect(Object.keys(recent[0] ?? {}).sort()).toEqual(['distance', 'endedAt', 'id', 'route', 'status', 'tier', 'wallet']);
  });

  it('who is online: the polling page counts (≤ 3 ids per address), signed-in wallets and drivers are players, watchers from the watch pages', async () => {
    const ctx = unitContext();
    const handler = new GetLiveHandler(ctx.rideQuery, ctx.rules, ctx.clock, ctx.sitePresence, ctx.viewers, ctx.stats);
    const ride = await ctx.freeRide('driver', true);
    ctx.viewers.seen(ride.id, '10.0.0.9', 'watcher-1', ctx.now());
    await handler.execute(new GetLiveQuery('visitor-aaaa', 'landing', '10.0.0.1', null));
    for (let i = 0; i < 6; i++) await handler.execute(new GetLiveQuery(`bot-${i}-xxxxxx`, 'lobby', '10.0.0.2', null));
    const feed = await handler.execute(new GetLiveQuery('visitor-bbbb', 'lobby', '10.0.0.3', 'fan'));
    expect(feed.online).toEqual({ total: 1 + 3 + 1 + 1 + 1, browsing: 5, watching: 1, driving: 1, players: 2 });
    expect(feed.rides[0]).toMatchObject({ id: ride.id, viewers: 1, signal: 'live' });
    ctx.clock.advance(31);   // the visitors' window (30 s) passed; the ride beat 31 s ago
    const later = await handler.execute(new GetLiveQuery());
    expect(later.online).toMatchObject({ browsing: 0, driving: 1 });
    ctx.clock.advance(15);
    expect((await handler.execute(new GetLiveQuery())).rides[0]?.signal).toBe('weak');   // 46 s without a heartbeat
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
