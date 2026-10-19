import { GetStatsHandler } from '../../../../../src/application/use-cases/stats/get-stats/get-stats.handler.js';
import { GetStatsQuery } from '../../../../../src/application/use-cases/stats/get-stats/get-stats.query.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetStatsHandler', () => {
  it('answers the game-wide totals from the statistics (zeros on a new database) and the number of drivers', async () => {
    const ctx = unitContext();
    const handler = new GetStatsHandler(ctx.stats);
    expect(await handler.execute()).toMatchObject({ rides: 0, metres: 0, seconds: 0, crashes: 0, donations: 0, drivers: 0 });
    await ctx.stats.recordDonation('d', 1_000, true);
    expect(await handler.execute()).toMatchObject({ donations: 1, donationLamports: 1_000, drivers: 0 });   // a donation alone does not make a driver
    void GetStatsQuery;
  });
});
