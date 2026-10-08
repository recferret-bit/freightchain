import { GetPrizePoolHandler } from '../../../../../src/application/use-cases/pools/get-prize-pool/get-prize-pool.handler.js';
import { GetPrizePoolQuery } from '../../../../../src/application/use-cases/pools/get-prize-pool/get-prize-pool.query.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

describe('GetPrizePoolHandler', () => {
  it('one pool in any status – a settled pool stays readable', async () => {
    const ctx = unitContext();
    await ctx.pools.upsert(aPool({ id: 9, status: 'settled', ticketsSold: 4, sponsored: 10_000_000 }));
    expect(await new GetPrizePoolHandler(ctx.pools, ctx.chainEvents).execute(new GetPrizePoolQuery(9))).toMatchObject({ id: 9, status: 'settled', sold: 4, potLamports: 210_000_000, sponsoredLamports: 10_000_000 });
  });

  it('the pool page carries its newest 20 on-chain events, newest first (other pools\' events left out)', async () => {
    const ctx = unitContext();
    await ctx.pools.upsert(aPool({ id: 1 }));
    for (let i = 0; i < 22; i++) {
      ctx.clock.ms += 1_000;
      await ctx.chainEvents.record({ signature: `sig-${i}`, index: 0, kind: 'TicketBought', poolId: 1, wallet: 'W', orderId: null, lamports: 50_000_000, outcome: 'applied', detail: null, at: ctx.now(), finalizedAt: i === 21 ? ctx.now() : null, lastValidBlockHeight: null });
    }
    await ctx.chainEvents.record({ signature: 'other', index: 0, kind: 'PoolFailed', poolId: 2, wallet: null, orderId: null, lamports: null, outcome: 'applied', detail: null, at: ctx.now(), finalizedAt: null, lastValidBlockHeight: null });
    const page = await new GetPrizePoolHandler(ctx.pools, ctx.chainEvents).execute(new GetPrizePoolQuery(1));
    expect(page.recent).toHaveLength(20);
    expect(page.recent[0]).toEqual({ signature: 'sig-21', kind: 'TicketBought', wallet: 'W', lamports: 50_000_000, outcome: 'applied', at: ctx.now().getTime(), finalized: true });
    expect(page.recent.at(-1)?.signature).toBe('sig-2');
  });

  it('unknown id → 404', async () => {
    await expect(new GetPrizePoolHandler(unitContext().pools, unitContext().chainEvents).execute(new GetPrizePoolQuery(1))).rejects.toThrow(new NotFoundError('no such pool'));
  });
});
