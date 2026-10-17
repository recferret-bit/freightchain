import { BadRequestError, ConflictError } from '../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../support/unit-context.js';
import { aPool } from '../../../support/pools.js';
import { promoInput, ticketEffect } from '../../../support/promos.js';

describe('PromoCreationService', () => {
  it('stores a ticket code and a ride code; a cab visual and an extra-free-ride code are refused', async () => {
    const ctx = unitContext();
    await ctx.promoCreation.create(promoInput({ code: 'TIX', effect: ticketEffect() }));
    await ctx.promoCreation.create(promoInput({ code: 'HAUL', effect: { kind: 'ride', tier: '4h' } }));
    await expect(ctx.promoCreation.create(promoInput({ code: 'WHEEL', effect: { kind: 'cosmetic', slot: 'wheel', item: 'gold' } }))).rejects.toMatchObject({ errorCode: 'visuals_are_honk' });
    await expect(ctx.promoCreation.create(promoInput({ code: 'OLD', effect: { kind: 'free_rides', count: 3 } }))).rejects.toMatchObject({ errorCode: 'promo_retired' });
    expect((await ctx.promos.list()).map((p) => p.effect.kind).sort()).toEqual(['ride', 'tickets']);
  });

  it('a duplicate is 409; the entity rules still apply', async () => {
    const ctx = unitContext();
    await ctx.promoCreation.create(promoInput({ code: 'hello-1' }));
    await expect(ctx.promoCreation.create(promoInput({ code: 'HELLO-1' }))).rejects.toThrow(new ConflictError('promo code HELLO-1 already exists', 'promo_exists'));
    await expect(ctx.promoCreation.create(promoInput({ code: 'P' }))).rejects.toBeInstanceOf(BadRequestError);
    await expect(ctx.promoCreation.create(promoInput({ code: 'OLD', expiresAt: ctx.now() }))).rejects.toBeInstanceOf(BadRequestError);
    await expect(ctx.promoCreation.create(promoInput({ code: 'TWICE', effect: { kind: 'ride', tier: '1h' }, perWallet: 2 }))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('a pinned pool must exist and be of the same tier', async () => {
    const ctx = unitContext();
    await expect(ctx.promoCreation.create(promoInput({ code: 'PIN', effect: ticketEffect({ poolId: 3 }) }))).rejects.toThrow('no pool 3');
    await ctx.pools.upsert(aPool({ id: 3, tier: '4h' }));
    await expect(ctx.promoCreation.create(promoInput({ code: 'PIN', effect: ticketEffect({ poolId: 3 }) }))).rejects.toThrow('pool 3 is a 4h pool, not 1h');
    const promo = await ctx.promoCreation.create(promoInput({ code: 'PIN', effect: ticketEffect({ poolId: 3, tier: '4h' }) }));
    expect(promo.effect).toMatchObject({ poolId: 3 });
    expect(await ctx.promos.findByCode('PIN')).not.toBeNull();
  });
});
