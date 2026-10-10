import { GetChainFeesHandler } from '../../../../../src/application/use-cases/chain/get-chain-fees/get-chain-fees.handler.js';
import { GetChainFeesQuery } from '../../../../../src/application/use-cases/chain/get-chain-fees/get-chain-fees.query.js';
import { ServiceUnavailableError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetChainFeesHandler', () => {
  it('the purchase quote of the pool (the wallet pays it) and how long a built transaction lives', async () => {
    const ctx = unitContext();
    ctx.poolChain.quote = { priorityMicrolamports: 12_000, computeUnits: 30_000, estimatedFeeLamports: 5_360 };
    expect(await new GetChainFeesHandler(ctx.poolChain).execute(new GetChainFeesQuery(4)))
      .toEqual({ priorityMicrolamports: 12_000, computeUnits: 30_000, estimatedFeeLamports: 5_360, blockhashTtlSeconds: 60 });
    expect(ctx.poolChain.feeQuotes).toEqual([{ poolId: 4, kind: 'buy' }]);
    await new GetChainFeesHandler(ctx.poolChain).execute(new GetChainFeesQuery());
    expect(ctx.poolChain.feeQuotes.at(-1)).toEqual({ poolId: null, kind: 'buy' });
  });

  it('an RPC outage stays a 503', async () => {
    const ctx = unitContext();
    ctx.poolChain.rpcDown = true;
    await expect(new GetChainFeesHandler(ctx.poolChain).execute(new GetChainFeesQuery())).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
