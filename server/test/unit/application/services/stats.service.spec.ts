import { RideStatus } from '../../../../src/domain/rides/ride-status.js';
import { GLOBAL_STATS_KEY, STATS_CACHE_TTL_SECONDS, playerStatsKey } from '../../../../src/application/services/stats.service.js';
import { unitContext } from '../../../support/unit-context.js';

/** a started free ride that ran `metres` / `seconds` and ended with `status` */
async function ended(ctx: ReturnType<typeof unitContext>, wallet: string, status: RideStatus, metres: number, seconds: number, crashes: [number, number] = [0, 0]) {
  const ride = await ctx.freeRide(wallet, true);
  const p = ride.snapshot();
  const done = (await import('../../../../src/domain/rides/ride.entity.js')).Ride.restore({ ...p, status, lastS: metres, driveSeconds: seconds, crashesVehicle: crashes[0], crashesBuilding: crashes[1], endedAt: ctx.now() });
  return done.snapshot();
}

describe('StatsService', () => {
  it('an ended ride joins the rider, then the game: metres, seconds, crashes, completed or not', async () => {
    const ctx = unitContext();
    expect(await ctx.stats.recordRide(await ended(ctx, 'a', RideStatus.Failed, 800, 60, [2, 1]))).toBe(true);
    expect(await ctx.stats.recordRide(await ended(ctx, 'a', RideStatus.Completed, 5000, 300))).toBe(true);
    expect(await ctx.stats.recordRide(await ended(ctx, 'b', RideStatus.Abandoned, 100, 10))).toBe(true);
    expect(await ctx.stats.player('a')).toMatchObject({ rides: 2, ridesCompleted: 1, metres: 5800, seconds: 360, crashes: 3, crashesVehicle: 2, crashesBuilding: 1 });
    expect(await ctx.stats.global()).toMatchObject({ rides: 3, ridesCompleted: 1, metres: 5900, seconds: 370, drivers: 2, crashes: 3 });
  });

  it('free and paid rides are counted apart, per rider and for the game (rides = free + paid)', async () => {
    const ctx = unitContext();
    await ctx.stats.recordRide(await ended(ctx, 'a', RideStatus.Failed, 100, 10));
    const order = await ctx.paidOrder('a');
    const paid = { ...order.snapshot(), status: RideStatus.Completed, startedAt: ctx.now(), lastS: 900, driveSeconds: 90 };
    await ctx.stats.recordRide(paid);
    await ctx.stats.recordRide(paid);
    expect(await ctx.stats.player('a')).toMatchObject({ rides: 3, ridesFree: 1, ridesPaid: 2, ridesCompleted: 2 });
    expect(await ctx.stats.global()).toMatchObject({ rides: 3, ridesFree: 1, ridesPaid: 2 });
  });

  it('a ride that never started is not counted', async () => {
    const ctx = unitContext();
    const order = await ctx.paidOrder('a');
    expect(await ctx.stats.recordRide(order.snapshot())).toBe(false);
    expect(await ctx.stats.global()).toMatchObject({ rides: 0, drivers: 0, updatedAt: 0 });
  });

  it('donations count on the DRIVER: all of them, lamports only the paid ones', async () => {
    const ctx = unitContext();
    await ctx.stats.recordDonation('driver', 0, false);
    await ctx.stats.recordDonation('driver', 2_000_000, true);
    expect(await ctx.stats.player('driver')).toMatchObject({ donations: 2, donationLamports: 2_000_000 });
    expect(await ctx.stats.global()).toMatchObject({ donations: 2, donationLamports: 2_000_000 });
  });

  it('reads are cached and a write drops the keys; the cache expires on the clock', async () => {
    const ctx = unitContext();
    await ctx.stats.global();
    expect(await ctx.cache.get(GLOBAL_STATS_KEY)).toMatchObject({ rides: 0 });
    await ctx.statsRepo.add('a', { rides: 1, ridesFree: 1, ridesPaid: 0, ridesCompleted: 0, seconds: 1, metres: 1, crashesVehicle: 0, crashesBuilding: 0, donations: 0, donationLamports: 0 }, ctx.now());
    expect((await ctx.stats.global()).rides).toBe(0);   // still the cached answer – the table moved behind it
    await ctx.stats.invalidate('a');
    expect(await ctx.cache.get(GLOBAL_STATS_KEY)).toBeNull();
    expect((await ctx.stats.global()).rides).toBe(1);
    await ctx.stats.player('a');
    expect(await ctx.cache.get(playerStatsKey('a'))).not.toBeNull();
    ctx.clock.advance(STATS_CACHE_TTL_SECONDS + 1);
    expect(await ctx.cache.get(playerStatsKey('a'))).toBeNull();
  });

  it('an unknown rider reads as zeros, never null', async () => {
    const ctx = unitContext();
    expect(await ctx.stats.player('nobody')).toEqual({ rides: 0, ridesFree: 0, ridesPaid: 0, ridesCompleted: 0, seconds: 0, metres: 0, crashes: 0, crashesVehicle: 0, crashesBuilding: 0, donations: 0, donationLamports: 0 });
  });
});
