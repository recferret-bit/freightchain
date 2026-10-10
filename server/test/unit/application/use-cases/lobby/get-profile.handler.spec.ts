import { GetProfileHandler } from '../../../../../src/application/use-cases/lobby/get-profile/get-profile.handler.js';
import { GetProfileQuery } from '../../../../../src/application/use-cases/lobby/get-profile/get-profile.query.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';
import { worldFor } from '../../../../../src/domain/rides/ride-rules.js';

describe('GetProfileHandler', () => {
  it('a fresh wallet: zero stats, 10 credits under a cap of 5, every achievement locked', async () => {
    const ctx = unitContext();
    const p = await new GetProfileHandler(ctx.sessions, ctx.achievements, ctx.rideQuery, ctx.payments, ctx.rules, ctx.clock, ctx.poolTickets, ctx.tickets, ctx.orders, new RecordingAnalytics(), ctx.stats).execute(new GetProfileQuery('w'));
    expect(p).toMatchObject({ wallet: 'w', freeRides: 10, freeRidesMax: 5, nextFreeRideAt: null, demo: false, stats: { rides: 0, completed: 0, metres: 0, bestMetres: 0, paidRides: 0, spentLamports: 0, ticketsBought: 0 }, recent: [], tickets: [], grants: [] });
    expect(p.achievements.every((a) => a.earnedAt === null)).toBe(true);
  });

  it('stats, recent rides and a catch-up of unlocks for a ride that never reached /end', async () => {
    const ctx = unitContext();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(5);
    ride.applyReport({ s: 60, t: 5, hull: 90, paused: false, night: false }, ctx.now(), ctx.rules.get());
    ride.failHeartbeatLost(ctx.now());
    await ctx.rides.save(ride);
    const p = await new GetProfileHandler(ctx.sessions, ctx.achievements, ctx.rideQuery, ctx.payments, ctx.rules, ctx.clock, ctx.poolTickets, ctx.tickets, ctx.orders, new RecordingAnalytics(), ctx.stats).execute(new GetProfileQuery('w'));
    expect(p.stats).toMatchObject({ rides: 1, completed: 0, metres: 60, bestMetres: 0 });
    expect(p.recent[0]).toMatchObject({ tier: 'free', status: 'failed', distance: 60, hull: 90, route: worldFor(ride.seed).route, endedAt: ctx.clock.ms });
    expect(p.achievements.find((a) => a.id === 'first-mile')?.earnedAt).toBe(ctx.clock.ms);
  });

  it('tickets per pool and the newest lines of the ticket audit trail', async () => {
    const ctx = unitContext();
    await ctx.pools.upsert(aPool({ id: 1, status: 'open' }));
    await ctx.tickets.open('w', 1);
    await ctx.tickets.appendGrant({ wallet: 'w', poolId: 1, delta: 2, source: 'promo', ref: 'HELLO', at: ctx.now() });
    const p = await new GetProfileHandler(ctx.sessions, ctx.achievements, ctx.rideQuery, ctx.payments, ctx.rules, ctx.clock, ctx.poolTickets, ctx.tickets, ctx.orders, new RecordingAnalytics(), ctx.stats).execute(new GetProfileQuery('w'));
    expect(p.tickets).toMatchObject([{ poolId: 1, balance: 0, status: 'open' }]);
    expect(p.grants).toEqual([{ poolId: 1, delta: 2, source: 'promo', ref: 'HELLO', at: ctx.clock.ms }]);
  });

  it('career: the rider\'s own running totals – and nobody else\'s', async () => {
    const ctx = unitContext();
    const handler = new GetProfileHandler(ctx.sessions, ctx.achievements, ctx.rideQuery, ctx.payments, ctx.rules, ctx.clock, ctx.poolTickets, ctx.tickets, ctx.orders, new RecordingAnalytics(), ctx.stats);
    expect((await handler.execute(new GetProfileQuery('w'))).career).toMatchObject({ rides: 0, metres: 0, crashes: 0, donations: 0 });
    await ctx.statsRepo.add('w', { rides: 2, ridesFree: 1, ridesPaid: 1, ridesCompleted: 1, seconds: 125.4, metres: 4321.6, crashesVehicle: 3, crashesBuilding: 1, donations: 2, donationLamports: 70_000 }, ctx.now());
    await ctx.statsRepo.add('other', { rides: 9, ridesFree: 9, ridesPaid: 0, ridesCompleted: 9, seconds: 1, metres: 9, crashesVehicle: 9, crashesBuilding: 9, donations: 9, donationLamports: 9 }, ctx.now());
    await ctx.stats.invalidate('w');
    expect((await handler.execute(new GetProfileQuery('w'))).career).toEqual({ rides: 2, ridesFree: 1, ridesPaid: 1, ridesCompleted: 1, seconds: 125, metres: 4322, crashes: 4, crashesVehicle: 3, crashesBuilding: 1, donations: 2, donationLamports: 70_000 });
  });
});
