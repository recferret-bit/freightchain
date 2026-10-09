import { SweepStaleRidesHandler } from '../../../../../src/application/use-cases/rides/sweep-stale-rides/sweep-stale-rides.handler.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { unitContext } from '../../../../support/unit-context.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';

describe('SweepStaleRidesHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const analytics = new RecordingAnalytics();
    const handler = new SweepStaleRidesHandler(ctx.rideQuery, ctx.rides, ctx.players, ctx.transactions, ctx.rules, ctx.clock, analytics, ctx.stats);
    return { ctx, analytics, sweep: () => handler.execute() };
  };
  const beat = async (ctx: ReturnType<typeof unitContext>, id: string, s: number, t: number) => {
    const ride = await ctx.reload(id);
    ride.applyReport({ s, t, hull: 100, paused: false, route: null, night: false }, ctx.now(), ctx.rules.get()); await ctx.rides.save(ride);
  };

  it('ends only the rides whose tab vanished (failed · heartbeat lost), once; fresh and ended rides are left alone; the analytics say who ended it', async () => {
    const { ctx, analytics, sweep } = setup();
    const gone = await ctx.freeRide('a', true), alive = await ctx.freeRide('b', true), done = await ctx.freeRide('c', true);
    ctx.clock.advance(100);
    await beat(ctx, alive.id, 140, 10);
    done.finish('shift', null, ctx.now()); await ctx.rides.save(done);
    ctx.clock.advance(60); // gone: 160 s without a heartbeat (> 150 s); alive: 60 s
    expect(await sweep()).toEqual({ ended: 1, skipped: 0 });
    expect((await ctx.reload(gone.id)).snapshot()).toMatchObject({ status: RideStatus.Failed, reason: 'heartbeat lost', endedAt: ctx.now() });
    expect((await ctx.reload(alive.id)).status).toBe(RideStatus.Running);
    expect((await ctx.reload(done.id)).status).toBe(RideStatus.Abandoned);
    expect(analytics.named('ride_failed').map((e) => e.properties)).toMatchObject([{ ride_id: gone.id, ended_by: 'stale_sweep', fail_code: 'heartbeat_lost' }]);
    expect(await sweep()).toEqual({ ended: 0, skipped: 0 });
  });

  it('statistics: a swept ride joins the totals once (its distance and time, never a completed shift); a fresh one waits', async () => {
    const { ctx, sweep } = setup();
    const gone = await ctx.freeRide('a', true), alive = await ctx.freeRide('b', true);
    ctx.clock.advance(5);
    await beat(ctx, gone.id, 70, 5); await beat(ctx, alive.id, 40, 5);
    ctx.clock.advance(100); await beat(ctx, alive.id, 90, 100);
    ctx.clock.advance(60);
    await sweep(); await sweep();
    expect(await ctx.stats.player('a')).toMatchObject({ rides: 1, ridesCompleted: 0, metres: 70, seconds: 5 });
    expect(await ctx.stats.player('b')).toMatchObject({ rides: 0 });
    expect(await ctx.stats.global()).toMatchObject({ rides: 1, metres: 70, drivers: 1 });
  });
});
