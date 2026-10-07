import { RedeemPromoHandler } from '../../../../../src/application/use-cases/players/redeem-promo/redeem-promo.handler.js';
import { RedeemPromoCommand } from '../../../../../src/application/use-cases/players/redeem-promo/redeem-promo.command.js';
import { PromoCode } from '../../../../../src/domain/economy/promo-code.entity.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

const DAY = 86_400_000;

describe('RedeemPromoHandler', () => {
  const setup = async (promo: Partial<Parameters<typeof PromoCode.create>[0]> = {}) => {
    const ctx = unitContext();
    await ctx.promos.insert(PromoCode.create({ code: 'HELLO', poolId: null, tier: '1h', credits: 2, maxRedemptions: 10, perWallet: 1, expiresAt: null, note: null, now: ctx.now(), ...promo }));
    const handler = new RedeemPromoHandler(ctx.players, ctx.promos, ctx.pools, ctx.tickets, ctx.poolTickets, ctx.sessions, ctx.transactions, ctx.clock);
    const redeem = (code = 'HELLO', wallet = 'w') => handler.execute(new RedeemPromoCommand(wallet, code));
    return { ctx, redeem };
  };

  it('grants the tickets into the live pool of the tier still selling (case and spaces forgiven) and records the redemption', async () => {
    const { ctx, redeem } = await setup();
    await ctx.pools.upsert(aPool({ id: 1, status: 'open', prepDeadline: new Date(ctx.clock.ms - 1) })); // preparation over – not selling any more
    await ctx.pools.upsert(aPool({ id: 2, status: 'active' }));
    expect(await redeem(' he llo ')).toEqual({ code: 'HELLO', poolId: 2, tier: '1h', added: 2, balance: 2, cap: 5 });
    expect((await ctx.promos.findByCode('HELLO'))?.snapshot().redeemed).toBe(1);
    expect(await ctx.promos.countRedemptions('HELLO', 'w')).toBe(1);
    expect(await ctx.tickets.recentGrants('w', 1)).toEqual([{ wallet: 'w', poolId: 2, delta: 2, source: 'promo', ref: 'HELLO', at: ctx.now() }]);
  });

  it('a pinned pool is used as long as it is open for entries', async () => {
    const { ctx, redeem } = await setup({ poolId: 7, tier: '4h' });
    await ctx.pools.upsert(aPool({ id: 3, tier: '4h', status: 'open' }));
    await ctx.pools.upsert(aPool({ id: 7, tier: '4h', status: 'open' }));
    expect((await redeem()).poolId).toBe(7);
    const closed = await setup({ poolId: 7 });
    await closed.ctx.pools.upsert(aPool({ id: 7, status: 'refunding' }));
    await expect(closed.redeem()).rejects.toMatchObject({ errorCode: 'no_open_pool', message: 'the pool of this promo code is no longer open' });
  });

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
    await ctx.promos.insert(PromoCode.create({ code: 'LATE', poolId: null, tier: '1h', credits: 1, maxRedemptions: null, perWallet: 1, expiresAt: new Date(ctx.clock.ms + DAY), note: null, now: ctx.now() }));
    ctx.clock.advance(86_400);
    await expect(redeem('LATE')).rejects.toMatchObject({ message: 'this promo code has expired' });
    await ctx.promos.disable('HELLO', ctx.now());
    await expect(redeem('HELLO', 'd')).rejects.toMatchObject({ message: 'this promo code is no longer valid' });
  });

  it('a wallet already at the pool cap is refused BEFORE a redemption is taken; below it the grant is clamped', async () => {
    const { ctx, redeem } = await setup({ credits: 4, perWallet: 2 });
    await ctx.pools.upsert(aPool({ id: 1, status: 'active', maxPerWallet: 5 }));
    const t = await ctx.tickets.open('w', 1); t.recordPurchase(3); await ctx.tickets.save(t);
    expect(await redeem()).toMatchObject({ added: 2, balance: 5, cap: 5 });
    await expect(redeem()).rejects.toMatchObject({ errorCode: 'ticket_cap', message: 'you already hold the maximum of 5 tickets in this pool' });
    expect((await ctx.promos.findByCode('HELLO'))?.snapshot().redeemed).toBe(1);
  });
});
