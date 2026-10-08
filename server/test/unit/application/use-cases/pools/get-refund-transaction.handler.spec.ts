import { GetRefundTransactionHandler } from '../../../../../src/application/use-cases/pools/get-refund-transaction/get-refund-transaction.handler.js';
import { GetRefundTransactionQuery } from '../../../../../src/application/use-cases/pools/get-refund-transaction/get-refund-transaction.query.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { TREASURY } from '../../../../support/fake-chain.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

const W = TREASURY;

describe('GetRefundTransactionHandler', () => {
  const setup = async (pool: Parameters<typeof aPool>[0], bought = 2) => {
    const ctx = unitContext();
    await ctx.pools.upsert(aPool({ id: 1, minTickets: 10, ...pool }, ctx.now()));
    await ctx.player(W);
    if (bought) { const t = await ctx.tickets.open(W, 1); t.recordPurchase(bought); await ctx.tickets.save(t); }
    const h = new GetRefundTransactionHandler(ctx.pools, ctx.tickets, ctx.poolChain, ctx.clock);
    return { ctx, refund: (wallet = W, poolId = 1) => h.execute(new GetRefundTransactionQuery(wallet, poolId)) };
  };

  it('a refunding pool: a self-paid refund of everything the wallet paid', async () => {
    const { ctx, refund } = await setup({ status: 'refunding' });
    expect(await refund()).toMatchObject({ poolId: 1, needsFail: false, lamports: 100_000_000, feePayer: W, sponsored: false });
    expect(ctx.poolChain.built[0]).toMatchObject({ kind: 'refund', input: { caller: W, buyer: W, poolId: 1, needsFail: false, selfPaid: true } });
  });

  it('an open pool past its preparation deadline under the minimum: fail_pool first', async () => {
    const { ctx, refund } = await setup({ status: 'open', ticketsSold: 2 });
    ctx.clock.advance(8 * 86_400);
    expect(await refund()).toMatchObject({ needsFail: true });
  });

  it('409 when the pool is live or the wallet paid nothing; 404 unknown pool', async () => {
    const live = await setup({ status: 'active' });
    await expect(live.refund()).rejects.toMatchObject({ errorCode: 'not_refundable' });
    const promoOnly = await setup({ status: 'refunding' }, 0);
    await expect(promoOnly.refund()).rejects.toMatchObject({ errorCode: 'nothing_to_refund' });
    await expect(promoOnly.refund(W, 9)).rejects.toThrow(new NotFoundError('no such pool'));
  });
});
