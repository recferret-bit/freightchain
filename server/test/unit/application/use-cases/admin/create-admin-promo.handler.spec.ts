import { CreateAdminPromoHandler } from '../../../../../src/application/use-cases/admin/create-admin-promo/create-admin-promo.handler.js';
import { CreateAdminPromoCommand } from '../../../../../src/application/use-cases/admin/create-admin-promo/create-admin-promo.command.js';
import { BadRequestError, ConflictError, UnauthorizedError } from '../../../../../src/domain/shared/errors.js';
import { testAdmin } from '../../../../support/admin-fixtures.js';
import { unitContext, type UnitContext } from '../../../../support/unit-context.js';
import { promoInput } from '../../../../support/promos.js';

const handlerOf = (ctx: UnitContext) => new CreateAdminPromoHandler(ctx.promoCreation, ctx.proofs, ctx.adminActions, ctx.transactions, ctx.clock);

describe('CreateAdminPromoHandler', () => {
  it('creates the code the wallet signed for, and audits it with the request id, the effect and the signed text', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const input = promoInput({ code: 'wheel-1', effect: { kind: 'cosmetic', slot: 'wheel', item: 'gold' }, description: 'A golden wheel', maxRedemptions: 100 });
    const signature = await admin.sign({ action: 'promo_create', promo: input });
    const dto = await handlerOf(ctx).execute(new CreateAdminPromoCommand(admin.wallet, input, 'req-7', signature));
    expect(dto).toMatchObject({ code: 'WHEEL-1', label: 'wheel: gold', state: 'active', description: 'A golden wheel' });
    expect(await ctx.promos.findByCode('WHEEL-1')).not.toBeNull();
    const [row] = ctx.db.adminActions;
    expect(row).toMatchObject({ wallet: admin.wallet, action: 'promo.create', target: 'WHEEL-1', detail: { effect: { kind: 'cosmetic', slot: 'wheel', item: 'gold' }, signed: { signature } }, requestId: 'req-7', at: ctx.now() });
    expect((row?.detail['signed'] as { message: string }).message).toContain('Action: CREATE promo code WHEEL-1');
  });

  it('no code without the right signature: another field, a replay, a forged key → 401, nothing created or audited', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const input = promoInput();
    const run = (signature: string, over = {}) => handlerOf(ctx).execute(new CreateAdminPromoCommand(admin.wallet, { ...input, ...over }, null, signature));
    await expect(run(await admin.sign({ action: 'promo_create', promo: input }), { maxRedemptions: 11 })).rejects.toThrow(/another change/);
    await expect(run(await admin.sign({ action: 'promo_create', promo: promoInput({ code: 'OTHER' }) }))).rejects.toThrow(/another change/);
    await expect(run(await admin.sign({ action: 'promo_disable', code: 'HELLO' }))).rejects.toThrow(/another change/);
    const message = await ctx.proofs.issue(admin.wallet, { action: 'promo_create', promo: input });
    await expect(run(admin.signText(message, testAdmin(ctx).kp))).rejects.toThrow(/bad signature/);
    await expect(run(admin.signText(message))).rejects.toThrow(/no signed request/); // consumed by the failed try
    await expect(run('garbage')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await ctx.promos.list()).toEqual([]);
    expect(ctx.db.adminActions).toEqual([]);
  });

  it('a bad code or a duplicate fails after a valid signature and leaves no audit row', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const first = promoInput();
    await handlerOf(ctx).execute(new CreateAdminPromoCommand(admin.wallet, first, null, await admin.sign({ action: 'promo_create', promo: first })));
    ctx.db.adminActions.length = 0;
    await expect(handlerOf(ctx).execute(new CreateAdminPromoCommand(admin.wallet, first, null, await admin.sign({ action: 'promo_create', promo: first })))).rejects.toBeInstanceOf(ConflictError);
    const bad = promoInput({ code: 'BAD', effect: { kind: 'free_rides', count: 0 } });
    await expect(handlerOf(ctx).execute(new CreateAdminPromoCommand(admin.wallet, bad, null, await admin.sign({ action: 'promo_create', promo: bad })))).rejects.toBeInstanceOf(BadRequestError);
    expect(ctx.db.adminActions).toEqual([]);
  });
});
