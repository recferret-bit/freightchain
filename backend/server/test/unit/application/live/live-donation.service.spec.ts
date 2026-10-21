import { Keypair } from '@solana/web3.js';
import { LiveDonationService } from '../../../../src/application/live/live-donation.service.js';
import { BadRequestError, TooManyRequestsError } from '../../../../src/domain/shared/errors.js';
import { TIP_DEFAULT_LAMPORTS, tipSplit } from '../../../../src/domain/live/tip-rules.js';
import { unitContext, unitRules } from '../../../support/unit-context.js';

describe('LiveDonationService', () => {
  const driver = Keypair.generate().publicKey.toBase58();
  const fan = Keypair.generate().publicKey.toBase58();

  const setup = (freeDonations = false) => {
    const ctx = unitContext(unitRules({ live: { chat: 'all', donations: true, freeDonations, effects: 'off' }, pledgesEnabled: true }));
    const donations = new LiveDonationService(ctx.replayAccess, ctx.donationOrders, ctx.rideMutes, ctx.rules, ctx.clock);
    return { ctx, donations };
  };

  const finished = async (ctx: ReturnType<typeof unitContext>) => {
    const ride = await ctx.paidRide(driver, true);
    ride.finish('failed', 'done', ctx.now());
    await ctx.rides.save(ride);
    return ride;
  };

  it('prices a tip on a finished replay at 95/5 and refuses a gameplay effect', async () => {
    const { ctx, donations } = setup();
    const ride = await finished(ctx);
    const tip = await donations.prepare(fan, ride.id, 'tip', null, 'order');
    expect(tip.lamports).toBe(TIP_DEFAULT_LAMPORTS);
    expect(tipSplit(tip.lamports)).toEqual({ driver: tip.driverLamports, treasury: tip.treasuryLamports });
    expect(tip.driverLamports + tip.treasuryLamports).toBe(tip.lamports);
    await expect(donations.prepare(fan, ride.id, 'night', null, 'order')).rejects.toThrow(new BadRequestError('only tip donations are accepted', 'donation_effect'));
    await expect(donations.prepare(fan, ride.id, 'tip', 999_999, 'order')).rejects.toMatchObject({ errorCode: 'donation_too_small' });
    await expect(donations.prepare(fan, ride.id, 'tip', 1_000_000_001, 'order')).rejects.toMatchObject({ errorCode: 'donation_too_large' });
  });

  it('refuses a tip on a running ride and a fourth open order', async () => {
    const { ctx, donations } = setup();
    const running = await ctx.paidRide(driver, true);
    await expect(donations.prepare(fan, running.id, 'tip', null, 'order')).rejects.toMatchObject({ errorCode: 'replay_not_available' });
    const ride = await finished(ctx);
    for (let i = 0; i < 3; i++) await donations.prepare(fan, ride.id, 'tip', 1_000_000, 'order').then(async (prepared) => {
      const { DonationOrder } = await import('../../../../src/domain/live/donation-order.entity.js');
      const order = DonationOrder.create({ id: ctx.entropy.uuid(), rideId: ride.id, wallet: fan, recipient: driver, effect: 'tip', now: ctx.now(), lamports: prepared.lamports });
      await ctx.donationOrders.insert(order);
    });
    await expect(donations.prepare(fan, ride.id, 'tip', 1_000_000, 'order')).rejects.toThrow(TooManyRequestsError);
  });
});
