import { EndRideHandler } from '../../../../../src/application/use-cases/rides/end-ride/end-ride.handler.js';
import { EndRideCommand } from '../../../../../src/application/use-cases/rides/end-ride/end-ride.command.js';
import { RideRepositoryPort } from '../../../../../src/application/ports/rides/ride.repository.port.js';
import type { RideReport } from '../../../../../src/domain/rides/ride-report.js';
import type { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { ConflictError, VersionConflictError } from '../../../../../src/domain/shared/errors.js';
import { RideLookupService } from '../../../../../src/application/services/ride-lookup.service.js';
import { unitContext } from '../../../../support/unit-context.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';
import { worldFor } from '../../../../../src/domain/rides/ride-rules.js';

const report = (over: Partial<RideReport>): RideReport => ({ s: null, t: null, hull: null, paused: true, night: false, ...over });

describe('EndRideHandler', () => {
  const setup = (rides?: RideRepositoryPort) => {
    const ctx = unitContext();
    const repo = rides ?? ctx.rides;
    const analytics = new RecordingAnalytics();
    const handler = new EndRideHandler(new RideLookupService(repo), repo, ctx.achievements, ctx.verdicts, ctx.rules, ctx.clock, analytics, ctx.transactions, ctx.players, ctx.stats);
    return { ctx, analytics, end: (id: string, outcome: 'shift' | 'failed', r: Partial<RideReport>, reason: string | null = null) => handler.execute(new EndRideCommand('w', id, outcome, report(r), reason)) };
  };

  it('completes a full shift and persists the unlocks it earned', async () => {
    const { ctx, analytics, end } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(10);
    expect(await end(ride.id, 'shift', { s: 140, t: 10, hull: 100 })).toMatchObject({ status: 'completed', reason: 'shift complete' });
    expect((await ctx.unlocks.listByWallet('w')).map((u) => u.achievementId).sort()).toEqual([...(worldFor(ride.seed).route === 'siberia' ? ['clean-run', 'cold-start'] : ['clean-run']), 'first-mile', 'on-my-own', 'shift-complete'].sort());
    expect(analytics.named('ride_completed')).toHaveLength(1);
    expect(analytics.named('ride_completed')[0]?.dedupeKey).toBe(`ride:${ride.id}:completed`);
    expect(analytics.named('ride_abandoned')).toEqual([]);
    expect(analytics.named('achievement_unlocked').map((e) => e.properties['achievement_id']).sort()).toEqual([...(worldFor(ride.seed).route === 'siberia' ? ['clean-run', 'cold-start'] : ['clean-run']), 'first-mile', 'on-my-own', 'shift-complete'].sort());
    expect(analytics.named('achievement_unlocked').every((e) => e.properties['achievement_id'] !== 'top-20')).toBe(true);
  });

  it('an early end is abandoned; a crash is failed with the reason', async () => {
    const { ctx, analytics, end } = setup();
    const early = await ctx.freeRide('w', true);
    ctx.clock.advance(3);
    expect(await end(early.id, 'shift', { s: 40, t: 3 })).toMatchObject({ status: 'abandoned' });
    expect(analytics.named('ride_abandoned')[0]?.properties).toMatchObject({ ride_id: early.id, reason_code: 'abandoned' });
    expect(analytics.named('ride_completed')).toEqual([]);
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
    const handler = new EndRideHandler(ctx.lookup, ctx.rides, broken, ctx.verdicts, ctx.rules, ctx.clock, new RecordingAnalytics(), ctx.transactions, ctx.players, ctx.stats);
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
    const handler = new EndRideHandler(new RideLookupService(new RacingRides()), new RacingRides(), base.achievements, base.verdicts, base.rules, base.clock, new RecordingAnalytics(), base.transactions, base.players, base.stats);
    base.clock.advance(2);
    expect(await handler.execute(new EndRideCommand('w', ride.id, 'failed', report({ s: 1, t: 2 }), 'crash'))).toMatchObject({ status: 'failed' });
    expect(saves).toBe(2);
  });

  it('statistics: every ending path counts what was driven – a shift, an early end, a crash, a refused final report – with the game\'s crash counters', async () => {
    const { ctx, end } = setup();
    const done = await ctx.freeRide('w', true);
    ctx.clock.advance(10);
    await end(done.id, 'shift', { s: 140, t: 10, hull: 100 });
    const early = await ctx.freeRide('w', true);
    ctx.clock.advance(3);
    await end(early.id, 'shift', { s: 40, t: 3, crashesVehicle: 2 });
    const crash = await ctx.freeRide('w', true);
    ctx.clock.advance(3);
    await end(crash.id, 'failed', { s: 12, t: 3, hull: 0, crashesBuilding: 1, crashesVehicle: 999_999 }, 'You crashed into a building');
    const refused = await ctx.freeRide('w', true);
    ctx.clock.advance(2);
    await end(refused.id, 'shift', { s: 5000, t: 2 });   // implausible: failed, and still a ride that started
    expect(await ctx.stats.player('w')).toMatchObject({ rides: 4, ridesCompleted: 1, metres: 140 + 40 + 12, crashesBuilding: 1, crashesVehicle: 2 + 4 });   // the crash cap of a ride that drove 3 s is 3 + 1
    expect(await ctx.stats.global()).toMatchObject({ rides: 4, ridesCompleted: 1, drivers: 1 });
  });

  it('statistics: a crash counter only goes up, and a rejected end writes nothing (the ride stays running, the totals unchanged)', async () => {
    const { ctx, end } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(5);
    await end(ride.id, 'shift', { s: 30, t: 5, crashesVehicle: 3 });
    await expect(end(ride.id, 'shift', { s: 30, t: 5 })).rejects.toThrow(/ride is/);
    expect(await ctx.stats.player('w')).toMatchObject({ rides: 1, crashesVehicle: 3 });
  });
});
