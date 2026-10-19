import { ReferralPayoutService } from '../../../../src/application/services/referral-payout.service.js';
import { poolPayouts } from '../../../../src/domain/economy/pool-payouts.js';
import { prizeBound, referralBound } from '../../../../src/domain/economy/vault-split.js';
import type { ReferralRecord } from '../../../../src/domain/referral/referral-rules.js';
import { MemoryReferralRepository } from '../../../support/in-memory/memory-referral-repository.js';
import { poolRide } from '../../../support/pool-rides.js';
import { aPool } from '../../../support/pools.js';
import { unitContext, type UnitContext } from '../../../support/unit-context.js';

const money = { priceLamports: 100, ticketsSold: 1, sponsored: 0, prizeBps: 6500, seedBps: 2000, feeBps: 1000, referralBps: 500 };

const refer = (ctx: UnitContext, referee: string, referrer: string, status: ReferralRecord['status'] = 'qualified') => {
  const now = ctx.now();
  ctx.db.referrals.set(referee, {
    referee, referrer, status, boundAt: now, expiresAt: new Date(now.getTime() + 86_400_000), qualifiedAt: status === 'qualified' ? now : null,
    rideId: null, freeGranted: false, badgeCounted: status === 'qualified',
  });
};

const bought = async (ctx: UnitContext, wallet: string) => {
  const t = await ctx.tickets.open(wallet, 1);
  t.recordPurchase(1);
  await ctx.tickets.save(t);
};

describe('ReferralPayoutService', () => {
  const leaves = (ctx: UnitContext) => new ReferralPayoutService(ctx.rideQuery, new MemoryReferralRepository(ctx.db), ctx.tickets, ctx.settings, ctx.clock).leaves(aPool(money));

  it('v5 has no on-chain referral leg, so a qualified referrer is not a leaf', async () => {
    const ctx = unitContext();
    await ctx.pools.upsert(aPool(money));
    await poolRide(ctx, 'A', 9_000);
    refer(ctx, 'A', 'R');
    await bought(ctx, 'A');
    const rows = await leaves(ctx);
    const prize = poolPayouts(prizeBound(money), ['A'])[0]!.lamports;
    expect(referralBound(money)).toBe(0);
    expect(rows.map((r) => r.kind)).toEqual(['rider']);
    expect(rows[0]).toMatchObject({ rank: 1, wallet: 'A', lamports: prize });
  });

  it('a promo ticket, a missing referrer, and a zero referral leg add nothing for a referrer', async () => {
    const ctx = unitContext();
    await poolRide(ctx, 'A', 9_000);
    refer(ctx, 'A', 'R'); // no on-chain purchase
    const promo = await leaves(ctx);
    const prize = poolPayouts(prizeBound(money), ['A'])[0]!.lamports;
    expect(promo.every((r) => r.kind !== 'referrer')).toBe(true);
    expect(promo[0]!.lamports).toBe(prize);

    const plain = unitContext();
    await poolRide(plain, 'A', 9_000);
    await bought(plain, 'A');
    const solo = await new ReferralPayoutService(plain.rideQuery, new MemoryReferralRepository(plain.db), plain.tickets, plain.settings, plain.clock).leaves(aPool({ priceLamports: 100, ticketsSold: 1 }));
    expect(solo).toHaveLength(1);
    expect(solo[0]).toMatchObject({ wallet: 'A', kind: 'rider', rank: 1 });
  });

  it('a pending, expired or self referral adds no leaf: the on-chain referral pot is 0', async () => {
    const ctx = unitContext();
    await poolRide(ctx, 'A', 9_000);
    refer(ctx, 'A', 'R', 'pending');
    await bought(ctx, 'A');
    expect((await leaves(ctx)).some((r) => r.kind === 'referrer')).toBe(false);

    const expired = unitContext();
    await poolRide(expired, 'A', 9_000);
    refer(expired, 'A', 'R', 'expired');
    await bought(expired, 'A');
    expect((await leaves(expired)).some((r) => r.kind === 'referrer')).toBe(false);

    const self = unitContext();
    await poolRide(self, 'A', 9_000);
    refer(self, 'A', 'A');
    await bought(self, 'A');
    expect((await leaves(self)).some((r) => r.kind === 'referrer')).toBe(false);

    const late = unitContext();
    await poolRide(late, 'A', 9_000);
    refer(late, 'A', 'R', 'pending');
    const row = late.db.referrals.get('A');
    if (!row) throw new Error('missing referral');
    row.expiresAt = new Date(late.now().getTime() - 1);
    await bought(late, 'A');
    expect((await leaves(late)).some((r) => r.kind === 'referrer')).toBe(false);
  });
});
