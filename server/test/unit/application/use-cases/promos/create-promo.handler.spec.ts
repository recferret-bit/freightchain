import { CreatePromoHandler } from '../../../../../src/application/use-cases/promos/create-promo/create-promo.handler.js';
import { CreatePromoCommand } from '../../../../../src/application/use-cases/promos/create-promo/create-promo.command.js';
import { unitContext } from '../../../../support/unit-context.js';
import { promoInput } from '../../../../support/promos.js';

describe('CreatePromoHandler', () => {
  it('stores the normalized code and returns it as the admin sees it', async () => {
    const ctx = unitContext();
    const dto = await new CreatePromoHandler(ctx.promoCreation, ctx.clock).execute(new CreatePromoCommand(promoInput({ code: 'hello-1', maxRedemptions: 100, note: 'launch', description: 'Welcome' })));
    expect(dto).toEqual({
      code: 'HELLO-1', effect: { kind: 'tickets', tier: '1h', poolId: null, credits: 2 }, label: '2 × 1h ride tickets', description: 'Welcome', state: 'active', maxRedemptions: 100, redeemed: 0,
      perWallet: 1, startsAt: ctx.clock.ms, expiresAt: null, disabledAt: null, note: 'launch', createdAt: ctx.clock.ms,
    });
    expect(await ctx.promos.findByCode('HELLO-1')).not.toBeNull();
  });
});
