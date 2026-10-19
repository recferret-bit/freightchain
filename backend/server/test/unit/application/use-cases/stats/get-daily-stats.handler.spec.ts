import { GetDailyStatsHandler } from '../../../../../src/application/use-cases/stats/get-daily-stats/get-daily-stats.handler.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetDailyStatsHandler', () => {
  it('answers the per-day history from the statistics: empty on a new database, one row per active UTC day after', async () => {
    const ctx = unitContext();
    const handler = new GetDailyStatsHandler(ctx.stats);
    expect(await handler.execute()).toEqual([]);
    await ctx.stats.recordDonation('d', 1_000, true);
    expect(await handler.execute()).toMatchObject([{ day: '2036-10-08', donations: 1, donationLamports: 1_000, rides: 0 }]);   // the first answer was cached: the write dropped it
  });
});
