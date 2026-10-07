import { GetPrizePoolHandler } from '../../../../../src/application/use-cases/pools/get-prize-pool/get-prize-pool.handler.js';
import { GetPrizePoolQuery } from '../../../../../src/application/use-cases/pools/get-prize-pool/get-prize-pool.query.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

describe('GetPrizePoolHandler', () => {
  it('one pool in any status – a settled pool stays readable', async () => {
    const ctx = unitContext();
    await ctx.pools.upsert(aPool({ id: 9, status: 'settled', ticketsSold: 4, sponsored: 10_000_000 }));
    expect(await new GetPrizePoolHandler(ctx.pools).execute(new GetPrizePoolQuery(9))).toMatchObject({ id: 9, status: 'settled', sold: 4, potLamports: 210_000_000, sponsoredLamports: 10_000_000 });
  });

  it('unknown id → 404', async () => {
    await expect(new GetPrizePoolHandler(unitContext().pools).execute(new GetPrizePoolQuery(1))).rejects.toThrow(new NotFoundError('no such pool'));
  });
});
