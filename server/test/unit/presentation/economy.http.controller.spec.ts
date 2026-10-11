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
    await c.leaderboard({ board: 'free', level: 2, tier: null, sort: 'time', page: 2, me: true }, 'alice'); expect(queries.last()).toEqual(new GetLeaderboardQuery('free', 2, 'time', 2, 'alice', null));
    await c.leaderboard({ board: 'round', level: null, tier: '4h', sort: 'distance', page: 1, me: false }, 'alice'); expect(queries.last()).toEqual(new GetLeaderboardQuery('round', null, 'distance', 1, null, '4h'));
  });

  it("an unknown or missing board falls back to the current round's", () => {
    expect(leaderboardQuerySchema.parse({}).board).toBe('round');
    expect(leaderboardQuerySchema.parse({ board: 'nope' }).board).toBe('round');
    expect(leaderboardQuerySchema.parse({ board: 'all' }).board).toBe('all');
  });

  it('level: the free board\'s level (a query string), HARD when absent; null on the paid boards, which refuse one', () => {
    expect(leaderboardQuerySchema.parse({ board: 'free' })).toEqual({ board: 'free', level: 3, tier: null, sort: 'distance', page: 1, me: false });
    expect(leaderboardQuerySchema.parse({ board: 'free', level: '1' })).toEqual({ board: 'free', level: 1, tier: null, sort: 'distance', page: 1, me: false });
    expect(leaderboardQuerySchema.parse({ board: 'free', level: '2' })).toEqual({ board: 'free', level: 2, tier: null, sort: 'distance', page: 1, me: false });
    expect(leaderboardQuerySchema.parse({ board: 'all' })).toEqual({ board: 'all', level: null, tier: null, sort: 'distance', page: 1, me: false });
    expect(leaderboardQuerySchema.parse({})).toEqual({ board: 'round', level: null, tier: null, sort: 'distance', page: 1, me: false });
    expect(leaderboardQuerySchema.parse({ sort: 'hull', page: '3', me: '1', board: 'all', tier: '8h' })).toEqual({ board: 'all', level: null, tier: '8h', sort: 'hull', page: 3, me: true });
    expect(leaderboardQuerySchema.parse({ sort: 'nope' }).sort).toBe('distance');
    for (const level of ['0', '4', '1.5', 'hard', '']) expect(leaderboardQuerySchema.safeParse({ board: 'free', level }).success).toBe(false);
    for (const board of ['all', 'round']) expect(leaderboardQuerySchema.safeParse({ board, level: '1' }).success).toBe(false);
    for (const page of ['0', '5', '1.5', 'nope']) expect(leaderboardQuerySchema.safeParse({ page }).success).toBe(false);
    expect(leaderboardQuerySchema.safeParse({ board: 'free', tier: '1h' }).success).toBe(false);
    expect(leaderboardQuerySchema.safeParse({ tier: '2h' }).success).toBe(false);
  });
});
