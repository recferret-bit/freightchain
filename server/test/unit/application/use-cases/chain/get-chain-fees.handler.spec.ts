import { GetChainFeesHandler } from '../../../../../src/application/use-cases/chain/get-chain-fees/get-chain-fees.handler.js';
import { GetChainFeesQuery } from '../../../../../src/application/use-cases/chain/get-chain-fees/get-chain-fees.query.js';
import { ServiceUnavailableError } from '../../../../../src/domain/shared/errors.js';
import { FixedRules, unitContext, unitRules } from '../../../../support/unit-context.js';

describe('GetChainFeesHandler', () => {
  it('the purchase quote of the pool, whether the sponsor pays it, and how long a built transaction lives', async () => {
    const ctx = unitContext();
    ctx.poolChain.quote = { priorityMicrolamports: 12_000, computeUnits: 30_000, estimatedFeeLamports: 5_360 };
    expect(await new GetChainFeesHandler(ctx.poolChain, ctx.rules).execute(new GetChainFeesQuery(4)))
      .toEqual({ priorityMicrolamports: 12_000, computeUnits: 30_000, estimatedFeeLamports: 5_360, sponsored: false, blockhashTtlSeconds: 60 });
    expect(ctx.poolChain.feeQuotes).toEqual([{ poolId: 4, kind: 'buy' }]);
    const sponsored = await new GetChainFeesHandler(ctx.poolChain, new FixedRules(unitRules({ sponsorEnabled: true }))).execute(new GetChainFeesQuery());
    expect(sponsored.sponsored).toBe(true);
    expect(ctx.poolChain.feeQuotes.at(-1)).toEqual({ poolId: null, kind: 'buy' });
  });

  it('an RPC outage stays a 503', async () => {
    const ctx = unitContext();
    ctx.poolChain.rpcDown = true;
    await expect(new GetChainFeesHandler(ctx.poolChain, ctx.rules).execute(new GetChainFeesQuery())).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
