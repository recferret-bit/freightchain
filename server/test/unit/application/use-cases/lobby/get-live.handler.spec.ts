import { GetLiveHandler } from '../../../../../src/application/use-cases/lobby/get-live/get-live.handler.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetLiveHandler', () => {
  it('running rides with a recent heartbeat, newest first, with the ride id (the watch link) but no seed or reason', async () => {
    const ctx = unitContext();
    const first = await ctx.freeRide('alice', true);
    ctx.clock.advance(1);
    await ctx.freeRide('bob', true);
    ctx.clock.advance(4);
    first.applyReport({ s: 70, t: 5, hull: 80, paused: true, route: 'siberia', night: false }, ctx.now(), ctx.rules.get());
    await ctx.rides.save(first);
    await ctx.freeRide('carol'); // not started
    const feed = await new GetLiveHandler(ctx.rideQuery, ctx.rules, ctx.clock).execute();
    expect(feed.now).toBe(ctx.clock.ms);
    expect(feed.rides.map((r) => r.wallet)).toEqual(['bob', 'alice']);
    expect(feed.rides[1]).toMatchObject({ tier: 'free', route: 'siberia', paused: true, hull: 80, distance: 70, driveSeconds: 5, minSeconds: 10, completeDist: 140, sinceBeat: 0, progress: 0.5 });
    expect(feed.rides[1]?.id).toBe(first.id);
    expect(Object.keys(feed.rides[1] ?? {})).not.toContain('seed'); expect(Object.keys(feed.rides[1] ?? {})).not.toContain('reason');
  });

  it('drops a ride whose heartbeats stopped longer than the timeout ago', async () => {
    const ctx = unitContext();
    await ctx.freeRide('alice', true);
    ctx.clock.advance(151);
    expect((await new GetLiveHandler(ctx.rideQuery, ctx.rules, ctx.clock).execute()).rides).toEqual([]);
  });

  const feed = (ctx: ReturnType<typeof unitContext>) => new GetLiveHandler(ctx.rideQuery, ctx.rules, ctx.clock).execute();

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
      r.applyReport({ s: metres, t: 1, hull: 100, paused: false, route: null, night: false }, ctx.now(), ctx.rules.get()); r.finish('failed', 'x', ctx.now()); await ctx.rides.save(r);
    };
    await end('alice', 12.4); ctx.clock.advance(5); await end('bob', 7);
    const { recent } = await feed(ctx);
    expect(recent.map((r) => [r.wallet, r.status, r.distance])).toEqual([['bob', 'failed', 7], ['alice', 'failed', 12]]);
    expect(Object.keys(recent[0] ?? {}).sort()).toEqual(['distance', 'endedAt', 'id', 'route', 'status', 'tier', 'wallet']);
  });

  it('totals: zeros on an empty feed', async () => {
    expect(await feed(unitContext())).toMatchObject({ rides: [], upcoming: [], recent: [], totals: { shifts: 0, metres: 0, drivers: 0 } });
  });
});

