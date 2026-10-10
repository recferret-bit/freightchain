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
    await c.leaderboard({ board: 'free', level: 2 }); expect(queries.last()).toEqual(new GetLeaderboardQuery('free', 2));
  });

  it("an unknown or missing board falls back to the current round's", () => {
    expect(leaderboardQuerySchema.parse({}).board).toBe('round');
    expect(leaderboardQuerySchema.parse({ board: 'nope' }).board).toBe('round');
    expect(leaderboardQuerySchema.parse({ board: 'all' }).board).toBe('all');
  });

  it('level: the free board\'s level (a query string), HARD when absent; null on the paid boards, which refuse one', () => {
    expect(leaderboardQuerySchema.parse({ board: 'free' })).toEqual({ board: 'free', level: 3 });
    expect(leaderboardQuerySchema.parse({ board: 'free', level: '1' })).toEqual({ board: 'free', level: 1 });
    expect(leaderboardQuerySchema.parse({ board: 'free', level: '2' })).toEqual({ board: 'free', level: 2 });
    expect(leaderboardQuerySchema.parse({ board: 'all' })).toEqual({ board: 'all', level: null });
    expect(leaderboardQuerySchema.parse({})).toEqual({ board: 'round', level: null });
    for (const level of ['0', '4', '1.5', 'hard', '']) expect(leaderboardQuerySchema.safeParse({ board: 'free', level }).success).toBe(false);
    for (const board of ['all', 'round']) expect(leaderboardQuerySchema.safeParse({ board, level: '1' }).success).toBe(false);
  });
});
