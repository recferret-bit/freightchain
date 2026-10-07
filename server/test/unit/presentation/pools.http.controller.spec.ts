import { PoolsHttpController } from '../../../src/presentation/economy/pools.http.controller.js';
import { ListPoolsQuery } from '../../../src/application/use-cases/pools/list-pools/list-pools.query.js';
import { GetPrizePoolQuery } from '../../../src/application/use-cases/pools/get-prize-pool/get-prize-pool.query.js';
import { RedeemPromoCommand } from '../../../src/application/use-cases/players/redeem-promo/redeem-promo.command.js';
import { poolIdParamsSchema, redeemPromoBodySchema } from '../../../src/presentation/economy/dto/pools.dto.js';
import { busMock } from '../../support/bus.js';

describe('PoolsHttpController', () => {
  it('list / get → their queries, redeem → the command with the signed-in wallet', async () => {
    const commands = busMock({ added: 2 }), queries = busMock({ pools: [] });
    const c = new PoolsHttpController(commands.bus, queries.bus);
    expect(await c.list()).toEqual({ pools: [] }); expect(queries.last()).toBeInstanceOf(ListPoolsQuery);
    await c.get({ id: 4 }); expect(queries.last()).toEqual(new GetPrizePoolQuery(4));
    expect(await c.redeem({ wallet: 'w' }, { code: 'hello' })).toEqual({ added: 2 });
    expect(commands.last()).toEqual(new RedeemPromoCommand('w', 'hello'));
  });

  it('a pool id is a u32; a promo code is a short non-empty string', () => {
    expect(poolIdParamsSchema.parse({ id: '7' }).id).toBe(7);
    for (const id of ['-1', '1.5', 'x', '4294967296']) expect(poolIdParamsSchema.safeParse({ id }).success, id).toBe(false);
    expect(redeemPromoBodySchema.parse({ code: '  hello ' }).code).toBe('hello');
    expect(redeemPromoBodySchema.safeParse({ code: '   ' }).success).toBe(false);
    expect(redeemPromoBodySchema.safeParse({ code: 'x'.repeat(65) }).success).toBe(false);
  });
});
