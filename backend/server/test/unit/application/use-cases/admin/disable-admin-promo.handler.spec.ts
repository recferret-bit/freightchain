import { DisableAdminPromoHandler } from '../../../../../src/application/use-cases/admin/disable-admin-promo/disable-admin-promo.handler.js';
import { DisableAdminPromoCommand } from '../../../../../src/application/use-cases/admin/disable-admin-promo/disable-admin-promo.command.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { testAdmin } from '../../../../support/admin-fixtures.js';
import { unitContext, type UnitContext } from '../../../../support/unit-context.js';
import { aPromo } from '../../../../support/promos.js';

const handlerOf = (ctx: UnitContext) => new DisableAdminPromoHandler(ctx.promos, ctx.proofs, ctx.adminActions, ctx.transactions, ctx.clock, ctx.analytics);

describe('DisableAdminPromoHandler', () => {
  it('stops the code the wallet signed for (typed in any case) and audits it', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    await ctx.promos.insert(aPromo(ctx.now()));
    const signature = await admin.sign({ action: 'promo_disable', code: 'HELLO' });
    const dto = await handlerOf(ctx).execute(new DisableAdminPromoCommand(admin.wallet, ' hello', 'req-1', signature));
    expect(dto).toMatchObject({ code: 'HELLO', state: 'disabled', disabledAt: ctx.clock.ms });
    expect(ctx.db.adminActions[0]).toMatchObject({ wallet: admin.wallet, action: 'promo.disable', target: 'HELLO', requestId: 'req-1', detail: { signed: { signature } } });
  });

  it('tells PostHog which code was stopped, of what kind and how often it was used', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    await ctx.promos.insert(aPromo(ctx.now(), { effect: { kind: 'free_rides', count: 3 } }));
    await ctx.promos.takeRedemption('HELLO', ctx.now());
    await handlerOf(ctx).execute(new DisableAdminPromoCommand(admin.wallet, 'hello', null, await admin.sign({ action: 'promo_disable', code: 'HELLO' })));
    expect(ctx.analytics.named('promo_disabled')).toMatchObject([{ distinctId: 'freightchain', dedupeKey: 'promo:HELLO:disabled', properties: { code: 'HELLO', kind: 'free_rides', redeemed: 1 } }]);
  });

  it('a signature for another code is refused and the code stays enabled', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    await ctx.promos.insert(aPromo(ctx.now()));
    await expect(handlerOf(ctx).execute(new DisableAdminPromoCommand(admin.wallet, 'HELLO', null, await admin.sign({ action: 'promo_disable', code: 'OTHER' })))).rejects.toThrow(/another change/);
    expect((await ctx.promos.findByCode('HELLO'))?.snapshot().disabledAt).toBeNull();
    expect(ctx.db.adminActions).toEqual([]);
    expect(ctx.analytics.named('promo_disabled')).toEqual([]);
  });

  it('an unknown code is a 404 after a valid signature, with no audit row', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    await expect(handlerOf(ctx).execute(new DisableAdminPromoCommand(admin.wallet, 'NOPE', null, await admin.sign({ action: 'promo_disable', code: 'NOPE' })))).rejects.toThrow(new NotFoundError('no such promo code'));
    expect(ctx.db.adminActions).toEqual([]);
  });
});
