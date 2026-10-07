import { HeartbeatRideHandler } from '../../../../../src/application/use-cases/rides/heartbeat-ride/heartbeat-ride.handler.js';
import { HeartbeatRideCommand } from '../../../../../src/application/use-cases/rides/heartbeat-ride/heartbeat-ride.command.js';
import type { RideReport } from '../../../../../src/domain/rides/ride-report.js';
import { ConflictError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

const report = (over: Partial<RideReport>): RideReport => ({ s: 0, t: null, hull: 100, paused: false, route: null, night: false, ...over });

describe('HeartbeatRideHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const handler = new HeartbeatRideHandler(ctx.lookup, ctx.rides, ctx.rules, ctx.clock);
    return { ctx, beat: (id: string, r: Partial<RideReport>) => handler.execute(new HeartbeatRideCommand('w', id, report(r))) };
  };

  it('applies the report and persists it', async () => {
    const { ctx, beat } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(5);
    expect(await beat(ride.id, { s: 70, t: 5, route: 'brenner' })).toMatchObject({ distance: 70, driveSeconds: 5, status: 'running' });
    expect((await ctx.reload(ride.id)).snapshot()).toMatchObject({ lastS: 70, route: 'brenner' });
  });

  it('a beat too soon after the last is ignored (no progress by spamming)', async () => {
    const { ctx, beat } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(0.5);
    expect(await beat(ride.id, { s: 10 })).toMatchObject({ distance: 0 });
  });

  it('a report that fails the ride is persisted as failed', async () => {
    const { ctx, beat } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(2);
    expect(await beat(ride.id, { s: 5000 })).toMatchObject({ status: 'failed' });
    expect((await ctx.reload(ride.id)).reason).toMatch(/implausible/);
  });

  it('only a running ride takes heartbeats', async () => {
    const { ctx, beat } = setup();
    await expect(beat((await ctx.freeRide('w')).id, { s: 1 })).rejects.toThrow(new ConflictError('ride is created'));
  });
});
