import { HeartbeatRideHandler } from '../../../../../src/application/use-cases/rides/heartbeat-ride/heartbeat-ride.handler.js';
import { HeartbeatRideCommand } from '../../../../../src/application/use-cases/rides/heartbeat-ride/heartbeat-ride.command.js';
import type { RideReport } from '../../../../../src/domain/rides/ride-report.js';
import { ConflictError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';

const report = (over: Partial<RideReport>): RideReport => ({ s: 0, t: null, hull: 100, paused: false, route: null, night: false, ...over });

describe('HeartbeatRideHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const analytics = new RecordingAnalytics();
    const handler = new HeartbeatRideHandler(ctx.lookup, ctx.rides, ctx.rules, ctx.clock, analytics, ctx.transactions, ctx.players, ctx.stats);
    return { ctx, analytics, beat: (id: string, r: Partial<RideReport>) => handler.execute(new HeartbeatRideCommand('w', id, report(r))) };
  };

  it('applies the report and persists it', async () => {
    const { ctx, beat } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(5);
    expect(await beat(ride.id, { s: 70, t: 5, route: 'brenner' })).toMatchObject({ distance: 70, driveSeconds: 5, status: 'running' });
    expect((await ctx.reload(ride.id)).snapshot()).toMatchObject({ lastS: 70, route: 'brenner' });
  });

  it('a beat too soon after the last is ignored (no progress by spamming)', async () => {
    const { ctx, analytics, beat } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(0.5);
    expect(await beat(ride.id, { s: 10 })).toMatchObject({ distance: 0 });
    expect(analytics.events).toEqual([]);
  });

  it('a report that fails the ride is persisted as failed', async () => {
    const { ctx, analytics, beat } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(2);
    expect(await beat(ride.id, { s: 5000 })).toMatchObject({ status: 'failed' });
    expect((await ctx.reload(ride.id)).reason).toMatch(/implausible/);
    expect(analytics.named('ride_progressed')).toEqual([]);
    expect(analytics.named('ride_failed')[0]?.properties).toMatchObject({ fail_code: 'implausible_progress', ended_by: 'heartbeat', ride_id: ride.id });
  });

  it('crossing 0.25 emits one ride_progressed and nothing else', async () => {
    const { ctx, analytics, beat } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(3);
    await beat(ride.id, { s: 40, t: 3 });
    expect(analytics.named('ride_progressed')).toHaveLength(1);
    expect(analytics.named('ride_progressed')[0]?.properties).toMatchObject({ milestone: 25, ride_id: ride.id });
    expect(analytics.named('ride_failed')).toEqual([]);
  });

  it('only a running ride takes heartbeats', async () => {
    const { ctx, beat } = setup();
    await expect(beat((await ctx.freeRide('w')).id, { s: 1 })).rejects.toThrow(new ConflictError('ride is created'));
  });

  it('a heartbeat never carries a dispatch prompt, and the ride stores none', async () => {
    const { ctx, beat } = setup();
    const ride = await ctx.freeRide('w', true);
    for (let t = 2; t <= 30; t += 2) {
      ctx.clock.advance(2);
      expect((await beat(ride.id, { s: t * 10, t })).challenge).toBeNull();
    }
    const saved = await ctx.reload(ride.id);
    expect(saved.challenges).toEqual([]);
    expect(saved.snapshot().nextChallengeAt).toBeNull();
  });

  it('statistics: a report that fails the ride ends it – its distance counts once; an ordinary beat counts nothing yet', async () => {
    const { ctx, beat } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(3);
    await beat(ride.id, { s: 20, t: 3, crashesVehicle: 1 });
    expect(await ctx.stats.player('w')).toMatchObject({ rides: 0, metres: 0 });
    ctx.clock.advance(2);
    expect(await beat(ride.id, { s: 9000 })).toMatchObject({ status: 'failed' });
    expect(await ctx.stats.player('w')).toMatchObject({ rides: 1, ridesCompleted: 0, metres: 20, crashesVehicle: 1 });   // what the ride had before the bad report
  });
});
