import { GetProfileHandler } from '../../../../../src/application/use-cases/lobby/get-profile/get-profile.handler.js';
import { GetProfileQuery } from '../../../../../src/application/use-cases/lobby/get-profile/get-profile.query.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetProfileHandler', () => {
  it('a fresh wallet: zero stats, 5 credits, every achievement locked', async () => {
    const ctx = unitContext();
    const p = await new GetProfileHandler(ctx.sessions, ctx.achievements, ctx.rideQuery, ctx.payments, ctx.rules, ctx.clock, new RecordingAnalytics()).execute(new GetProfileQuery('w'));
    expect(p).toMatchObject({ wallet: 'w', freeRides: 5, freeRidesMax: 5, nextFreeRideAt: null, demo: false, stats: { rides: 0, completed: 0, metres: 0, bestMetres: 0, paidRides: 0, spentLamports: 0 }, recent: [] });
    expect(p.achievements.every((a) => a.earnedAt === null)).toBe(true);
  });

  it('stats, recent rides and a catch-up of unlocks for a ride that never reached /end', async () => {
    const ctx = unitContext();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(5);
    ride.applyReport({ s: 60, t: 5, hull: 90, paused: false, route: 'brenner', night: false }, ctx.now(), ctx.rules.get());
    ride.failHeartbeatLost(ctx.now());
    await ctx.rides.save(ride);
    const p = await new GetProfileHandler(ctx.sessions, ctx.achievements, ctx.rideQuery, ctx.payments, ctx.rules, ctx.clock, new RecordingAnalytics()).execute(new GetProfileQuery('w'));
    expect(p.stats).toMatchObject({ rides: 1, completed: 0, metres: 60, bestMetres: 0 });
    expect(p.recent[0]).toMatchObject({ tier: 'free', status: 'failed', distance: 60, hull: 90, route: 'brenner', endedAt: ctx.clock.ms });
    expect(p.achievements.find((a) => a.id === 'first-mile')?.earnedAt).toBe(ctx.clock.ms);
  });
});
