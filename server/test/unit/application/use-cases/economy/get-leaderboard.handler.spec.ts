import { GetLeaderboardHandler } from '../../../../../src/application/use-cases/economy/get-leaderboard/get-leaderboard.handler.js';
import { GetLeaderboardQuery } from '../../../../../src/application/use-cases/economy/get-leaderboard/get-leaderboard.query.js';
import { unitContext, type UnitContext } from '../../../../support/unit-context.js';

/** a completed ride of `metres` for `wallet` (paid into the current round unless free) */
async function completed(ctx: UnitContext, wallet: string, metres: number, free = false) {
  const ride = free ? await ctx.freeRide(wallet) : await ctx.paidOrder(wallet);
  if (!free) ride.markPaid((await ctx.rounds.ensureRound()).id, ctx.now());
  ride.start(ctx.now());
  ctx.clock.advance(1);
  ride.applyReport({ s: Math.min(metres, 40), t: 1, hull: 100, paused: false, route: null, night: false }, ctx.now(), ctx.rules.get());
  const p = ride.snapshot();
  const { Ride } = await import('../../../../../src/domain/rides/ride.entity.js');
  const done = Ride.restore({ ...p, lastS: metres, status: 'completed' as never, endedAt: ctx.now() });
  await ctx.rides.save(done);
}

describe('GetLeaderboardHandler', () => {
  it('ranks completed rides by total distance per wallet; boards keep paid and free apart', async () => {
    const ctx = unitContext();
    await completed(ctx, 'alice', 500);
    await completed(ctx, 'bob', 900);
    await completed(ctx, 'alice', 600); // alice: 1100 over two rides
    await completed(ctx, 'carol', 5000, true);
    const handler = new GetLeaderboardHandler(ctx.rounds, ctx.rideQuery);
    const round = await handler.execute(new GetLeaderboardQuery('round'));
    expect(round).toMatchObject({ board: 'round', prizeRanks: 20 });
    expect(round.rows).toEqual([{ rank: 1, wallet: 'alice', distance: 1100, rides: 2 }, { rank: 2, wallet: 'bob', distance: 900, rides: 1 }]);
    expect((await handler.execute(new GetLeaderboardQuery('free'))).rows).toEqual([{ rank: 1, wallet: 'carol', distance: 5000, rides: 1 }]);
    expect((await handler.execute(new GetLeaderboardQuery('all'))).rows.map((r) => r.wallet)).toEqual(['alice', 'bob']);
  });

  it("'round' is only the CURRENT week", async () => {
    const ctx = unitContext();
    await completed(ctx, 'alice', 500);
    ctx.clock.advance(8 * 86_400);
    const handler = new GetLeaderboardHandler(ctx.rounds, ctx.rideQuery);
    expect((await handler.execute(new GetLeaderboardQuery('round'))).rows).toEqual([]);
    expect((await handler.execute(new GetLeaderboardQuery('all'))).rows).toHaveLength(1);
  });
});
