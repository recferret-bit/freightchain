import { ListPromoRedemptionsHandler } from '../../../../../src/application/use-cases/admin/list-promo-redemptions/list-promo-redemptions.handler.js';
import { ListPromoRedemptionsQuery } from '../../../../../src/application/use-cases/admin/list-promo-redemptions/list-promo-redemptions.query.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPromo } from '../../../../support/promos.js';

describe('ListPromoRedemptionsHandler', () => {
  const setup = async () => {
    const ctx = unitContext();
    await ctx.promos.insert(aPromo(ctx.now(), { code: 'AAA', perWallet: 2, maxRedemptions: null }));
    await ctx.promos.insert(aPromo(ctx.now(), { code: 'BBB', effect: { kind: 'free_rides', count: 3 } }));
    for (const [code, wallet, n] of [['AAA', 'w1', 1], ['BBB', 'w1', 1], ['AAA', 'w2', 1], ['AAA', 'w1', 2]] as const) {
      ctx.clock.advance(10);
      await ctx.promos.insertRedemption(code, wallet, n, ctx.now());
    }
    return { ctx, handler: new ListPromoRedemptionsHandler(ctx.promos) };
  };

  it('who used which code, newest first, with what it gave', async () => {
    const { ctx, handler } = await setup();
    const { rows } = await handler.execute(new ListPromoRedemptionsQuery(100, null, null));
    expect(rows.map((r) => [r.code, r.wallet, r.n, r.label])).toEqual([
      ['AAA', 'w1', 2, '2 × 1h ride tickets'], ['AAA', 'w2', 1, '2 × 1h ride tickets'], ['BBB', 'w1', 1, '3 free rides'], ['AAA', 'w1', 1, '2 × 1h ride tickets'],
    ]);
    expect(rows[0]?.at).toBe(ctx.clock.ms);
  });

  it('narrows by code (typed in any case) or wallet, and by limit', async () => {
    const { handler } = await setup();
    expect((await handler.execute(new ListPromoRedemptionsQuery(100, ' aaa', null))).rows.map((r) => r.wallet)).toEqual(['w1', 'w2', 'w1']);
    expect((await handler.execute(new ListPromoRedemptionsQuery(100, null, 'w1'))).rows.map((r) => r.code)).toEqual(['AAA', 'BBB', 'AAA']);
    expect((await handler.execute(new ListPromoRedemptionsQuery(100, 'BBB', 'w2'))).rows).toEqual([]);
    expect((await handler.execute(new ListPromoRedemptionsQuery(2, null, null))).rows).toHaveLength(2);
  });
});
