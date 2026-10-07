import { EndRideHandler } from '../../../../../src/application/use-cases/rides/end-ride/end-ride.handler.js';
import { EndRideCommand } from '../../../../../src/application/use-cases/rides/end-ride/end-ride.command.js';
import { RideRepositoryPort } from '../../../../../src/application/ports/rides/ride.repository.port.js';
import type { RideReport } from '../../../../../src/domain/rides/ride-report.js';
import type { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { ConflictError, VersionConflictError } from '../../../../../src/domain/shared/errors.js';
import { RideLookupService } from '../../../../../src/application/services/ride-lookup.service.js';
import { unitContext } from '../../../../support/unit-context.js';

const report = (over: Partial<RideReport>): RideReport => ({ s: null, t: null, hull: null, paused: true, route: null, night: false, ...over });

describe('EndRideHandler', () => {
  const setup = (rides?: RideRepositoryPort) => {
    const ctx = unitContext();
    const repo = rides ?? ctx.rides;
    const handler = new EndRideHandler(new RideLookupService(repo), repo, ctx.achievements, ctx.rules, ctx.clock);
    return { ctx, end: (id: string, outcome: 'shift' | 'failed', r: Partial<RideReport>, reason: string | null = null) => handler.execute(new EndRideCommand('w', id, outcome, report(r), reason)) };
  };

  it('completes a full shift and persists the unlocks it earned', async () => {
    const { ctx, end } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(10);
    expect(await end(ride.id, 'shift', { s: 140, t: 10, hull: 100 })).toMatchObject({ status: 'completed', reason: 'shift complete' });
    expect((await ctx.unlocks.listByWallet('w')).map((u) => u.achievementId).sort()).toEqual(['clean-run', 'first-mile', 'shift-complete']);
  });

  it('an early end is abandoned; a crash is failed with the reason', async () => {
    const { ctx, end } = setup();
    const early = await ctx.freeRide('w', true);
    ctx.clock.advance(3);
    expect(await end(early.id, 'shift', { s: 40, t: 3 })).toMatchObject({ status: 'abandoned' });
    const crash = await ctx.freeRide('w', true);
    ctx.clock.advance(3);
    expect(await end(crash.id, 'failed', { s: 1, t: 3 }, 'crash')).toMatchObject({ status: 'failed', reason: 'crash' });
  });

  it('a final report that fails the ride wins over the outcome', async () => {
    const { ctx, end } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(2);
    expect((await end(ride.id, 'shift', { s: 5000, t: 2 })).reason).toMatch(/implausible/);
  });

  it('a failure while persisting the unlocks does not turn the saved verdict into a 500 (the profile catches them up later)', async () => {
    const ctx = unitContext();
    const ride = await ctx.freeRide('w', true);
    const broken = { evaluate: async () => { throw new Error('pool timeout'); } } as unknown as typeof ctx.achievements;
    const handler = new EndRideHandler(ctx.lookup, ctx.rides, broken, ctx.rules, ctx.clock);
    ctx.clock.advance(10);
    expect(await handler.execute(new EndRideCommand('w', ride.id, 'shift', report({ s: 140, t: 10, hull: 100 }), null))).toMatchObject({ status: 'completed' });
    expect((await ctx.reload(ride.id)).status).toBe('completed');
  });

  it('only a running ride ends', async () => {
    const { ctx, end } = setup();
    await expect(end((await ctx.freeRide('w')).id, 'shift', {})).rejects.toThrow(new ConflictError('ride is created'));
  });

  it('retries when a racing heartbeat saved the ride in between – an end always lands', async () => {
    const base = unitContext();
    let saves = 0;
    class RacingRides extends RideRepositoryPort {
      findById = (id: string) => base.rides.findById(id);
      findOpenByWallet = (w: string) => base.rides.findOpenByWallet(w);
      listOpenByWallet = (w: string) => base.rides.listOpenByWallet(w);
      findPendingPaid = (w: string, s: Date) => base.rides.findPendingPaid(w, s);
      insert = (r: Ride) => base.rides.insert(r);
      async save(r: Ride) { if (saves++ === 0) throw new VersionConflictError(); return base.rides.save(r); }
    }
    const ride = await base.freeRide('w', true);
    const handler = new EndRideHandler(new RideLookupService(new RacingRides()), new RacingRides(), base.achievements, base.rules, base.clock);
    base.clock.advance(2);
    expect(await handler.execute(new EndRideCommand('w', ride.id, 'failed', report({ s: 1, t: 2 }), 'crash'))).toMatchObject({ status: 'failed' });
    expect(saves).toBe(2);
  });
});
