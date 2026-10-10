import { GetPoolStandingsHandler } from '../../../../../src/application/use-cases/pools/get-pool-standings/get-pool-standings.handler.js';
import { GetPoolStandingsQuery } from '../../../../../src/application/use-cases/pools/get-pool-standings/get-pool-standings.query.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { poolRide } from '../../../../support/pool-rides.js';
import { aPool } from '../../../../support/pools.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetPoolStandingsHandler – the public winners list', () => {
  const setup = async () => {
    const ctx = unitContext();
    await ctx.pools.upsert(aPool({ id: 1, status: 'active', ticketsSold: 10, minTickets: 2 }, ctx.now())); // 0.5 SOL pot → prize 0.35 SOL
    const h = new GetPoolStandingsHandler(ctx.pools, ctx.poolPayouts, ctx.rideQuery);
    return { ctx, standings: () => h.execute(new GetPoolStandingsQuery(1)) };
  };

  it('PROVISIONAL before the payout plan: the verified ranking with what each rank would get, and how many rides wait for review', async () => {
    const { ctx, standings } = await setup();
    await poolRide(ctx, 'bob', 500); await poolRide(ctx, 'bob', 500); await poolRide(ctx, 'alice', 900);
    await poolRide(ctx, 'carol', 5_000, 'flagged'); // under review: not ranked yet, counted
    const s = await standings();
    expect(s).toMatchObject({ poolId: 1, tier: '1h', prizeLamports: 350_000_000, final: false, underReview: 1, payout: { state: 'pending', note: null, held: false } });
    expect(s.ranks).toEqual([
      { rank: 1, wallet: 'bob', distance: 1000, rides: 2, lamports: 175_000_000, paid: false, signature: null },
      { rank: 2, wallet: 'alice', distance: 900, rides: 1, lamports: 125_000_000, paid: false, signature: null },
    ]);
  });

  it('FINAL once the payout job planned it: its ranks and amounts, and what was paid', async () => {
    const { ctx, standings } = await setup();
    await poolRide(ctx, 'alice', 900);
    await ctx.poolPayouts.plan([{ poolId: 1, rank: 1, wallet: 'alice', lamports: 300_000_000, status: 'planned' }], ctx.now());
    await ctx.poolPayouts.claimSent(1, 1, 'Sig1', 9, ctx.now());
    await ctx.poolPayouts.markPaid(1, 1, 'Sig1', ctx.now());
    expect(await standings()).toMatchObject({ final: true, ranks: [{ rank: 1, wallet: 'alice', distance: 900, rides: 1, lamports: 300_000_000, paid: true, signature: 'Sig1' }] });
  });

  it('an unknown pool is a 404', async () => {
    const ctx = unitContext();
    await expect(new GetPoolStandingsHandler(ctx.pools, ctx.poolPayouts, ctx.rideQuery).execute(new GetPoolStandingsQuery(9))).rejects.toBeInstanceOf(NotFoundError);
  });
});
