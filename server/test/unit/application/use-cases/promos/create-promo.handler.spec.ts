import { CreatePromoHandler } from '../../../../../src/application/use-cases/promos/create-promo/create-promo.handler.js';
import { CreatePromoCommand } from '../../../../../src/application/use-cases/promos/create-promo/create-promo.command.js';
import { BadRequestError, ConflictError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

const input = (over: Partial<CreatePromoCommand['input']> = {}): CreatePromoCommand['input'] =>
  ({ code: 'hello-1', tier: '1h', poolId: null, credits: 2, maxRedemptions: 100, perWallet: 1, expiresAt: null, note: 'launch', ...over });

describe('CreatePromoHandler', () => {
  it('stores the normalized code and returns it', async () => {
    const ctx = unitContext();
    const dto = await new CreatePromoHandler(ctx.promos, ctx.pools, ctx.clock).execute(new CreatePromoCommand(input()));
    expect(dto).toEqual({ code: 'HELLO-1', tier: '1h', poolId: null, credits: 2, maxRedemptions: 100, redeemed: 0, perWallet: 1, expiresAt: null, disabledAt: null, note: 'launch', createdAt: ctx.clock.ms });
    expect(await ctx.promos.findByCode('HELLO-1')).not.toBeNull();
  });

  it('a duplicate is 409; a pinned pool must exist and be of the same tier; the entity rules still apply', async () => {
    const ctx = unitContext();
    const handler = new CreatePromoHandler(ctx.promos, ctx.pools, ctx.clock);
    await handler.execute(new CreatePromoCommand(input()));
    await expect(handler.execute(new CreatePromoCommand(input({ code: 'HELLO-1' })))).rejects.toThrow(new ConflictError('promo code HELLO-1 already exists', 'promo_exists'));
    await expect(handler.execute(new CreatePromoCommand(input({ code: 'P', poolId: 3 })))).rejects.toBeInstanceOf(BadRequestError); // too short, before the pool is looked at
    await expect(handler.execute(new CreatePromoCommand(input({ code: 'PIN', poolId: 3 })))).rejects.toThrow('no pool 3');
    await ctx.pools.upsert(aPool({ id: 3, tier: '4h' }));
    await expect(handler.execute(new CreatePromoCommand(input({ code: 'PIN', poolId: 3 })))).rejects.toThrow('pool 3 is a 4h pool, not 1h');
    expect((await handler.execute(new CreatePromoCommand(input({ code: 'PIN', poolId: 3, tier: '4h' })))).poolId).toBe(3);
    await expect(handler.execute(new CreatePromoCommand(input({ code: 'OLD', expiresAt: ctx.now() })))).rejects.toBeInstanceOf(BadRequestError);
  });
});
