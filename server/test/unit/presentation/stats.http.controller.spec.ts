import { StatsHttpController } from '../../../src/presentation/stats/stats.http.controller.js';
import { GetStatsQuery } from '../../../src/application/use-cases/stats/get-stats/get-stats.query.js';
import { busMock } from '../../support/bus.js';

describe('StatsHttpController', () => {
  it('GET /api/stats → GetStatsQuery, answered through the bus', async () => {
    const queries = busMock({ rides: 3 });
    expect(await new StatsHttpController(queries.bus).stats()).toEqual({ rides: 3 });
    expect(queries.last()).toEqual(new GetStatsQuery());
  });
});
