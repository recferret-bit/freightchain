import { ReconcileStatsHandler } from '../../../../../src/application/use-cases/stats/reconcile-stats/reconcile-stats.handler.js';
import { ReconcileStatsCommand } from '../../../../../src/application/use-cases/stats/reconcile-stats/reconcile-stats.command.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { RideEvent } from '../../../../../src/domain/live/ride-event.entity.js';
import { EMPTY_STATS } from '../../../../../src/domain/stats/stats.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('ReconcileStatsHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const handler = new ReconcileStatsHandler(ctx.statsRepo, ctx.cache, ctx.clock);
    const finish = async (wallet: string, metres: number, status = RideStatus.Failed) => {
      const ride = await ctx.freeRide(wallet, true);
      await ctx.rides.save(Ride.restore({ ...ride.snapshot(), status, lastS: metres, driveSeconds: 10, crashesVehicle: 1, endedAt: ctx.now() }));
      return ride;
    };
    return { ctx, finish, run: (wallet: string | null = null, fix = false) => handler.execute(new ReconcileStatsCommand(wallet, fix)) };
  };

  it('a clean database has no drift', async () => {
    const { ctx, finish, run } = setup();
    const ride = await finish('a', 500);
    await ctx.stats.recordRide((await ctx.reload(ride.id)).snapshot());
    expect(await run()).toEqual({ checked: 1, drifted: [], global: null, days: [], fixed: false });
  });

  it('finds a ride whose totals were lost, reports it without --fix, repairs it with --fix (rider row + global row + cache)', async () => {
    const { ctx, finish, run } = setup();
    await finish('a', 500); await finish('b', 300);   // no stats were ever written for them
    await ctx.stats.global();                         // and the empty answer is cached
    const report = await run();
    expect(report.drifted.map((d) => d.wallet).sort()).toEqual(['a', 'b']);
    expect(report.drifted[0]?.fields.rides).toEqual({ stored: 0, truth: 1 });
    expect(report.global).toMatchObject({ rides: { stored: 0, truth: 2 }, metres: { stored: 0, truth: 800 } });
    expect(report.days).toMatchObject([{ day: '2036-10-08', fields: { rides: { stored: 0, truth: 2 }, metres: { stored: 0, truth: 800 } } }]);
    expect(report.fixed).toBe(false);
    expect((await ctx.statsRepo.findGlobal())).toBeNull();   // read-only without --fix
    expect(await run(null, true)).toMatchObject({ fixed: true });
    expect(await ctx.statsRepo.findGlobal()).toMatchObject({ totals: { rides: 2, metres: 800, crashesVehicle: 2 } });
    expect(await ctx.stats.global()).toMatchObject({ rides: 2, drivers: 2 });   // the cached zeros are gone
    expect(await ctx.statsRepo.listAllDaily()).toEqual(new Map([['2036-10-08', expect.objectContaining({ rides: 2, metres: 800 })]]));   // the history is rebuilt too
    expect(await run()).toMatchObject({ drifted: [], global: null, days: [], fixed: false });
  });

  it('a row with nothing behind it is removed; donations are counted on the ride owner, paid lamports only', async () => {
    const { ctx, finish, run } = setup();
    const ride = await finish('a', 100);
    await ctx.statsRepo.add('ghost', { ...EMPTY_STATS, rides: 9, metres: 9 }, ctx.now());
    await ctx.rideEvents.insert(RideEvent.donation({ rideId: ride.id, wallet: 'fan', effect: 'tip', now: ctx.now() }));
    ctx.clock.advance(5);
    await ctx.rideEvents.insert(RideEvent.donation({ rideId: ride.id, wallet: 'fan2', effect: 'tip', now: ctx.now(), paid: { orderId: 'o1', signature: 'sig1', lamports: 40_000 } }));
    await run(null, true);
    expect((await ctx.statsRepo.listPlayers()).has('ghost')).toBe(false);
    expect((await ctx.statsRepo.findPlayer('a'))?.totals).toMatchObject({ rides: 1, donations: 2, donationLamports: 40_000 });
  });

  it('the history is checked too: a day that was edited, or has nothing behind it, is found and repaired (everyone scope only)', async () => {
    const { ctx, finish, run } = setup();
    const ride = await finish('a', 500);
    await ctx.stats.recordRide((await ctx.reload(ride.id)).snapshot());
    await ctx.statsRepo.add('a', { ...EMPTY_STATS, rides: 4, metres: 40 }, ctx.now(), undefined, new Date(Date.UTC(2036, 8, 1)));   // a stray day …
    await ctx.statsRepo.add('a', { ...EMPTY_STATS, rides: 1 }, ctx.now(), undefined, ctx.now());   // … and the real day too high
    const report = await run();
    expect(report.days.map((d) => d.day)).toEqual(['2036-09-01', '2036-10-08']);
    expect((await run('a')).days).toEqual([]);
    await run(null, true);
    expect([...(await ctx.statsRepo.listAllDaily()).keys()]).toEqual(['2036-10-08']);
    expect(await run()).toMatchObject({ days: [] });
  });

  it('one wallet only: the others are not touched', async () => {
    const { ctx, finish, run } = setup();
    await finish('a', 500); await finish('b', 300);
    expect(await run('a', true)).toMatchObject({ checked: 1, fixed: true, global: null });
    expect(await ctx.statsRepo.findPlayer('a')).not.toBeNull();
    expect(await ctx.statsRepo.findPlayer('b')).toBeNull();
  });
});
