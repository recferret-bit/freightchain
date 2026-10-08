import { GetPoolHandler } from '../../../../../src/application/use-cases/economy/get-pool/get-pool.handler.js';
import { Payment } from '../../../../../src/domain/economy/payment.entity.js';
import { StubPrice } from '../../../../support/stub-price.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

describe('GetPoolHandler', () => {
  it("the current round's entries split 50 / 20 / 20 / 10, with ≈ USD at the current price", async () => {
    const ctx = unitContext();
    const round = await ctx.rounds.ensureRound();
    await ctx.payments.insert(new Payment({ signature: 's1', rideId: 'r1', wallet: 'w', lamports: 1_000_000_000, usd: 100, roundId: round.id, at: ctx.now() }));
    const pool = await new GetPoolHandler(ctx.rounds, ctx.roundRepo, new StubPrice(100), ctx.pools).execute();
    expect(pool).toMatchObject({
      round: { id: round.id, startsAt: round.startsAt.getTime(), endsAt: round.endsAt.getTime() }, entries: 1, settled: false, solUsd: 100,
      split: { entries: 1e9, carry: 0, grand: 5e8, top20: 2e8, nextSeed: 2e8, fees: 1e8 },
      usd: { grand: 50, top20: 20, nextSeed: 20, fees: 10, entries: 100 },
    });
  });

  it('no price → the lamports still, usd null', async () => {
    const ctx = unitContext();
    const pool = await new GetPoolHandler(ctx.rounds, ctx.roundRepo, new StubPrice(null), ctx.pools).execute();
    expect(pool.solUsd).toBeNull();
    expect(pool.usd).toEqual({ grand: null, top20: null, nextSeed: null, fees: null, entries: null });
    expect(pool.pools).toEqual([]);
  });

  it('lists the live escrowed pools', async () => {
    const ctx = unitContext();
    await ctx.pools.upsert(aPool({ id: 4, status: 'active', ticketsSold: 3, vaultLamports: 150_000_000 }));
    await ctx.pools.upsert(aPool({ id: 5, status: 'cancelled' }));
    const pool = await new GetPoolHandler(ctx.rounds, ctx.roundRepo, new StubPrice(100), ctx.pools).execute();
    expect(pool.pools.map((p) => [p.id, p.sold, p.vaultLamports])).toEqual([[4, 3, 150_000_000]]);
  });
});
