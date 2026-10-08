import { RedeemPromoHandler } from '../../../../../src/application/use-cases/players/redeem-promo/redeem-promo.handler.js';
import { RedeemPromoCommand } from '../../../../../src/application/use-cases/players/redeem-promo/redeem-promo.command.js';
import type { PromoCreateInput } from '../../../../../src/domain/economy/promo.types.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';
import { aPromo, ticketEffect } from '../../../../support/promos.js';

const DAY = 86_400_000;

describe('RedeemPromoHandler', () => {
  const setup = async (promo: Partial<PromoCreateInput> = {}) => {
    const ctx = unitContext();
    await ctx.promos.insert(aPromo(ctx.now(), promo));
    const handler = new RedeemPromoHandler(ctx.players, ctx.promos, ctx.pools, ctx.tickets, ctx.cosmetics, ctx.poolTickets, ctx.sessions, ctx.transactions, ctx.clock);
    const redeem = (code = 'HELLO', wallet = 'w') => handler.execute(new RedeemPromoCommand(wallet, code));
    return { ctx, redeem };
  };

  describe('tickets', () => {
    it('grants the tickets into the live pool of the tier still selling (case and spaces forgiven) and records the redemption', async () => {
      const { ctx, redeem } = await setup();
      await ctx.pools.upsert(aPool({ id: 1, status: 'open', prepDeadline: new Date(ctx.clock.ms - 1) })); // preparation over – not selling any more
      await ctx.pools.upsert(aPool({ id: 2, status: 'active' }));
      expect(await redeem(' he llo ')).toEqual({ kind: 'tickets', code: 'HELLO', label: '2 × 1h ride tickets', poolId: 2, tier: '1h', added: 2, balance: 2, cap: 5 });
      expect((await ctx.promos.findByCode('HELLO'))?.snapshot().redeemed).toBe(1);
      expect(await ctx.promos.countRedemptions('HELLO', 'w')).toBe(1);
      expect(await ctx.tickets.recentGrants('w', 1)).toEqual([{ wallet: 'w', poolId: 2, delta: 2, source: 'promo', ref: 'HELLO', at: ctx.now() }]);
    });

    it('a pinned pool is used as long as it is open for entries', async () => {
      const { ctx, redeem } = await setup({ effect: ticketEffect({ poolId: 7, tier: '4h' }) });
      await ctx.pools.upsert(aPool({ id: 3, tier: '4h', status: 'open' }));
      await ctx.pools.upsert(aPool({ id: 7, tier: '4h', status: 'open' }));
      expect(await redeem()).toMatchObject({ kind: 'tickets', poolId: 7 });
      const closed = await setup({ effect: ticketEffect({ poolId: 7 }) });
      await closed.ctx.pools.upsert(aPool({ id: 7, status: 'refunding' }));
      await expect(closed.redeem()).rejects.toMatchObject({ errorCode: 'no_open_pool', message: 'the pool of this promo code is no longer open' });
    });

    it('a wallet already at the pool cap is refused BEFORE a redemption is taken; below it the grant is clamped', async () => {
      const { ctx, redeem } = await setup({ effect: ticketEffect({ credits: 4 }), perWallet: 2 });
      await ctx.pools.upsert(aPool({ id: 1, status: 'active', maxPerWallet: 5 }));
      const t = await ctx.tickets.open('w', 1); t.recordPurchase(3); await ctx.tickets.save(t);
      expect(await redeem()).toMatchObject({ added: 2, balance: 5, cap: 5 });
      await expect(redeem()).rejects.toMatchObject({ errorCode: 'ticket_cap', message: 'you already hold the maximum of 5 tickets in this pool' });
      expect((await ctx.promos.findByCode('HELLO'))?.snapshot().redeemed).toBe(1);
    });
  });

  describe('free rides', () => {
    it('adds them on top of the daily ones – even above the daily cap – and nothing else', async () => {
      const { ctx, redeem } = await setup({ effect: { kind: 'free_rides', count: 3 } });
      await ctx.player('w'); // 5 of 5
      expect(await redeem()).toEqual({ kind: 'free_rides', code: 'HELLO', label: '3 free rides', added: 3, freeRides: 8 });
      expect((await ctx.storedPlayer('w')).freeRides).toBe(8);
      expect((await ctx.storedPlayer('w')).freeRidesMax).toBe(5);
      expect(await ctx.promos.countRedemptions('HELLO', 'w')).toBe(1);
      expect(await ctx.tickets.listByWallet('w')).toEqual([]); // no ticket row either
    });

    it('is not pulled back down by the daily grant the next day, and a ride spends from it', async () => {
      const { ctx, redeem } = await setup({ effect: { kind: 'free_rides', count: 1 } });
      await ctx.player('w');
      await redeem();
      ctx.clock.advance(86_400);
      await ctx.sessions.touch('w'); // the lazy daily grant: at / above the cap it adds nothing and takes nothing
      expect((await ctx.storedPlayer('w')).freeRides).toBe(6);
    });

    it('one ride in "1 free ride" reads singular', async () => {
      const { redeem } = await setup({ effect: { kind: 'free_rides', count: 1 } });
      expect(await redeem()).toMatchObject({ label: '1 free ride', added: 1 });
    });
  });

  describe('cosmetics', () => {
    const wheel = { kind: 'cosmetic', slot: 'wheel', item: 'sport' } as const;

    it('unlocks the item and puts it on', async () => {
      const { ctx, redeem } = await setup({ effect: wheel });
      expect(await redeem()).toEqual({ kind: 'cosmetic', code: 'HELLO', label: 'wheel: sport', slot: 'wheel', item: 'sport' });
      expect(await ctx.cosmetics.has('w', 'wheel', 'sport')).toBe(true);
      expect(await ctx.cosmetics.listEquipped('w')).toEqual({ wheel: 'sport' });
      expect((await ctx.cosmetics.listUnlocked('w'))[0]).toMatchObject({ code: 'HELLO', at: ctx.now() });
    });

    it('a wallet that already owns it is refused BEFORE a redemption is taken – another code for the same item', async () => {
      const { ctx, redeem } = await setup({ effect: wheel, maxRedemptions: 5 });
      await ctx.promos.insert(aPromo(ctx.now(), { code: 'AGAIN', effect: wheel, maxRedemptions: 5 }));
      await redeem();
      await expect(redeem('AGAIN')).rejects.toMatchObject({ errorCode: 'already_owned', message: 'you already own this item' });
      expect((await ctx.promos.findByCode('AGAIN'))?.snapshot().redeemed).toBe(0);
    });

    it('a second code for another slot keeps the first item', async () => {
      const { ctx, redeem } = await setup({ effect: wheel });
      await ctx.promos.insert(aPromo(ctx.now(), { code: 'BOX', effect: { kind: 'cosmetic', slot: 'gearbox', item: 'chrome' } }));
      await redeem(); await redeem('BOX');
      expect(await ctx.cosmetics.listEquipped('w')).toEqual({ wheel: 'sport', gearbox: 'chrome' });
    });
  });

  describe('every kind', () => {
    it('unknown or malformed codes are 404 without touching anything', async () => {
      const { redeem } = await setup();
      await expect(redeem('NOPE')).rejects.toThrow(new NotFoundError('no such promo code'));
      await expect(redeem('!!')).rejects.toThrow(new NotFoundError('no such promo code'));
    });

    it('409s: per-wallet limit, fully redeemed, expired, disabled, no open pool', async () => {
      const { ctx, redeem } = await setup({ maxRedemptions: 2, expiresAt: new Date(Date.UTC(2036, 9, 8, 12) + 2 * DAY) });
      await expect(redeem()).rejects.toMatchObject({ errorCode: 'no_open_pool', message: 'no 1h pool is open right now' });
      await ctx.pools.upsert(aPool({ id: 1, status: 'open' }));
      await redeem();
      await expect(redeem()).rejects.toMatchObject({ errorCode: 'promo_unavailable', message: 'you have already redeemed this promo code' });
      await redeem('HELLO', 'b');
      await expect(redeem('HELLO', 'c')).rejects.toMatchObject({ message: 'this promo code has been fully redeemed' });
      ctx.clock.advance(3 * 86_400);
      await ctx.promos.insert(aPromo(ctx.now(), { code: 'LATE', maxRedemptions: null, expiresAt: new Date(ctx.clock.ms + DAY) }));
      ctx.clock.advance(86_400);
      await expect(redeem('LATE')).rejects.toMatchObject({ message: 'this promo code has expired' });
      await ctx.promos.disable('HELLO', ctx.now());
      await expect(redeem('HELLO', 'd')).rejects.toMatchObject({ message: 'this promo code is no longer valid' });
    });

    it('a code scheduled for later is refused until its start – and works from that very instant', async () => {
      const { ctx, redeem } = await setup({ effect: { kind: 'free_rides', count: 2 }, startsAt: new Date(Date.UTC(2036, 9, 8, 12) + DAY) });
      await expect(redeem()).rejects.toMatchObject({ errorCode: 'promo_unavailable', message: 'this promo code is not active yet' });
      expect(await ctx.promos.countRedemptions('HELLO', 'w')).toBe(0);
      ctx.clock.advance(86_400);
      expect(await redeem()).toMatchObject({ kind: 'free_rides', added: 2 });
    });
  });
});
