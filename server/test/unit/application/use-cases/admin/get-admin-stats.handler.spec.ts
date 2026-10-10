import { GetAdminStatsHandler } from '../../../../../src/application/use-cases/admin/get-admin-stats/get-admin-stats.handler.js';
import { GetAdminStatsQuery } from '../../../../../src/application/use-cases/admin/get-admin-stats/get-admin-stats.query.js';
import { EMPTY_STATS } from '../../../../../src/domain/stats/stats.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetAdminStatsHandler', () => {
  it('no ride yet: the global row does not exist, no days, no riders', async () => {
    const ctx = unitContext();
    const d = await new GetAdminStatsHandler(ctx.statsRepo, ctx.adminDirectory, ctx.clock).execute(new GetAdminStatsQuery(30, 20));
    expect(d).toEqual({ now: ctx.clock.ms, global: null, daily: [], top: [] });
  });

  it('the game totals with the driver count, the days, and the top riders by distance (rounded, limited)', async () => {
    const ctx = unitContext();
    for (const [w, metres] of [['a', 100.4], ['b', 900.6], ['c', 500]] as const) await ctx.statsRepo.add(w, { ...EMPTY_STATS, rides: 1, ridesFree: 1, metres, seconds: 5 }, ctx.now());
    const h = new GetAdminStatsHandler(ctx.statsRepo, ctx.adminDirectory, ctx.clock);
    const d = await h.execute(new GetAdminStatsQuery(30, 2));
    expect(d.global).toMatchObject({ rides: 3, metres: 1501, seconds: 15, drivers: 3, updatedAt: ctx.clock.ms });
    expect(d.top.map((r) => [r.wallet, r.stats.metres])).toEqual([['b', 901], ['c', 500]]);
    expect(d.daily.at(-1)).toMatchObject({ rides: 3 });
  });

  it('`days` limits the history to the newest days (UTC, today included)', async () => {
    const ctx = unitContext();
    for (let back = 3; back >= 0; back--) await ctx.statsRepo.add('a', { ...EMPTY_STATS, rides: 1 }, ctx.now(), undefined, new Date(ctx.clock.ms - back * 86_400_000));
    const h = new GetAdminStatsHandler(ctx.statsRepo, ctx.adminDirectory, ctx.clock);
    expect((await h.execute(new GetAdminStatsQuery(2, 5))).daily).toHaveLength(2);
    expect((await h.execute(new GetAdminStatsQuery(30, 5))).daily).toHaveLength(4);
  });
});
