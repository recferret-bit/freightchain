import { DisablePromoHandler } from '../../../../../src/application/use-cases/promos/disable-promo/disable-promo.handler.js';
import { DisablePromoCommand } from '../../../../../src/application/use-cases/promos/disable-promo/disable-promo.command.js';
import { PromoCode } from '../../../../../src/domain/economy/promo-code.entity.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('DisablePromoHandler', () => {
  it('stamps the code (typed in any case) once; unknown → 404', async () => {
    const ctx = unitContext();
    await ctx.promos.insert(PromoCode.create({ code: 'HELLO', poolId: null, tier: '1h', credits: 1, maxRedemptions: null, perWallet: 1, expiresAt: null, note: null, now: ctx.now() }));
    const handler = new DisablePromoHandler(ctx.promos, ctx.clock);
    expect((await handler.execute(new DisablePromoCommand('hello'))).disabledAt).toBe(ctx.clock.ms);
    ctx.clock.advance(10);
    expect((await handler.execute(new DisablePromoCommand('HELLO'))).disabledAt).toBe(ctx.clock.ms - 10_000);
    await expect(handler.execute(new DisablePromoCommand('NOPE'))).rejects.toThrow(new NotFoundError('no such promo code'));
  });
});
