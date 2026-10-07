import { EconomyHttpController } from '../../../src/presentation/economy/economy.http.controller.js';
import { GetTiersQuery } from '../../../src/application/use-cases/economy/get-tiers/get-tiers.query.js';
import { GetPoolQuery } from '../../../src/application/use-cases/economy/get-pool/get-pool.query.js';
import { GetLeaderboardQuery } from '../../../src/application/use-cases/economy/get-leaderboard/get-leaderboard.query.js';
import { leaderboardQuerySchema } from '../../../src/presentation/economy/dto/economy.dto.js';
import { busMock } from '../../support/bus.js';

describe('EconomyHttpController', () => {
  it('tiers / pool / leaderboard → their queries', async () => {
    const queries = busMock({ any: 1 });
    const c = new EconomyHttpController(queries.bus);
    expect(await c.tiers()).toEqual({ any: 1 }); expect(queries.last()).toBeInstanceOf(GetTiersQuery);
    await c.pool(); expect(queries.last()).toBeInstanceOf(GetPoolQuery);
    await c.leaderboard({ board: 'free' }); expect(queries.last()).toEqual(new GetLeaderboardQuery('free'));
  });

  it("an unknown or missing board falls back to the current round's", () => {
    expect(leaderboardQuerySchema.parse({}).board).toBe('round');
    expect(leaderboardQuerySchema.parse({ board: 'nope' }).board).toBe('round');
    expect(leaderboardQuerySchema.parse({ board: 'all' }).board).toBe('all');
  });
});
