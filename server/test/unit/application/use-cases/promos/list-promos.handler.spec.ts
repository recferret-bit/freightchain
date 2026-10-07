import { ListPromosHandler } from '../../../../../src/application/use-cases/promos/list-promos/list-promos.handler.js';
import { PromoCode } from '../../../../../src/domain/economy/promo-code.entity.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('ListPromosHandler', () => {
  it('every code, newest first, with its usage', async () => {
    const ctx = unitContext();
    const make = (code: string) => PromoCode.create({ code, poolId: null, tier: '1h', credits: 1, maxRedemptions: null, perWallet: 1, expiresAt: null, note: null, now: ctx.now() });
    await ctx.promos.insert(make('FIRST'));
    ctx.clock.advance(60);
    await ctx.promos.insert(make('SECOND'));
    const { promos } = await new ListPromosHandler(ctx.promos).execute();
    expect(promos.map((p) => [p.code, p.redeemed])).toEqual([['SECOND', 0], ['FIRST', 0]]);
  });
});
