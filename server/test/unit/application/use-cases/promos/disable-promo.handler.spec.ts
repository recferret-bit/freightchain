import { DisablePromoHandler } from '../../../../../src/application/use-cases/promos/disable-promo/disable-promo.handler.js';
import { DisablePromoCommand } from '../../../../../src/application/use-cases/promos/disable-promo/disable-promo.command.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPromo } from '../../../../support/promos.js';

describe('DisablePromoHandler', () => {
  it('stamps the code (typed in any case) once; unknown → 404', async () => {
    const ctx = unitContext();
    await ctx.promos.insert(aPromo(ctx.now()));
    const handler = new DisablePromoHandler(ctx.promos, ctx.clock);
    const first = await handler.execute(new DisablePromoCommand('hello'));
    expect([first.disabledAt, first.state]).toEqual([ctx.clock.ms, 'disabled']);
    ctx.clock.advance(10);
    expect((await handler.execute(new DisablePromoCommand('HELLO'))).disabledAt).toBe(ctx.clock.ms - 10_000);
    await expect(handler.execute(new DisablePromoCommand('NOPE'))).rejects.toThrow(new NotFoundError('no such promo code'));
  });
});
