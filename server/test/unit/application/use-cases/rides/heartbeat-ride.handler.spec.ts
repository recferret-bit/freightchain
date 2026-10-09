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
    const handler = new HeartbeatRideHandler(ctx.lookup, ctx.rides, ctx.rules, ctx.clock, analytics, ctx.entropy, ctx.transactions, ctx.players, ctx.stats);
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

  it('issues a dispatch prompt when one is due and answers with it (and with the open one again until its window closes)', async () => {
    const { ctx, beat } = setup();   // the 10 s free shift: interval 2.5 s, the first due at 1.25 s (SequenceEntropy draws ≈ 0)
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(2);
    expect((await beat(ride.id, { s: 20, t: 2 })).challenge).toBeNull(); // scheduled on the first beat
    ctx.clock.advance(2);
    const c = (await beat(ride.id, { s: 40, t: 4 })).challenge;
    expect(c).toMatchObject({ action: 'headlights', label: 'FLASH YOUR HEADLIGHTS', key: 'L', codes: ['KeyL', 'btn:head'], issuedMs: 4000, deadlineMs: 24_000 });
    expect((await ctx.reload(ride.id)).challenges).toEqual([{ id: c!.id, action: 'headlights', issuedMs: 4000, deadlineMs: 24_000 }]);
    ctx.clock.advance(0.5);
    expect((await beat(ride.id, { s: 45, t: 4.5 })).challenge?.id).toBe(c!.id); // too soon to count, still carries the open prompt
    ctx.clock.advance(25);
    const later = await beat(ride.id, { s: 400, t: 29 });
    expect(later.challenge && later.challenge.id !== c!.id).toBe(true); // the next one is due by now; the first has closed
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
