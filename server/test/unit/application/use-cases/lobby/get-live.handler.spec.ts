import { GetLiveHandler } from '../../../../../src/application/use-cases/lobby/get-live/get-live.handler.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetLiveHandler', () => {
  it('running rides with a recent heartbeat, newest first, without ids or reasons', async () => {
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
    expect(Object.keys(feed.rides[1] ?? {})).not.toContain('id');
  });

  it('drops a ride whose heartbeats stopped longer than the timeout ago', async () => {
    const ctx = unitContext();
    await ctx.freeRide('alice', true);
    ctx.clock.advance(151);
    expect((await new GetLiveHandler(ctx.rideQuery, ctx.rules, ctx.clock).execute()).rides).toEqual([]);
  });
});
