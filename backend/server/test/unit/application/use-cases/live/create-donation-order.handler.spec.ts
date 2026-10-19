import { Keypair } from '@solana/web3.js';
import { CreateDonationOrderHandler } from '../../../../../src/application/use-cases/live/create-donation-order/create-donation-order.handler.js';
import { CreateDonationOrderCommand } from '../../../../../src/application/use-cases/live/create-donation-order/create-donation-order.command.js';
import { RideEvent } from '../../../../../src/domain/live/ride-event.entity.js';
import { EFFECTS } from '../../../../../src/domain/live/live-rules.js';
import { ConflictError, ForbiddenError, TooManyRequestsError } from '../../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

describe('CreateDonationOrderHandler', () => {
  const setup = (freeDonations = false) => {
    const ctx = unitContext(unitRules({ live: { chat: 'all', donations: true, freeDonations, effects: 'all' } }));
    const handler = new CreateDonationOrderHandler(ctx.liveAccess, ctx.donationOrders, ctx.rideEvents, ctx.chain, ctx.entropy, ctx.clock);
    return { ctx, order: (wallet: string, rideId: string, effect: 'tip' | 'night' = 'night') => handler.execute(new CreateDonationOrderCommand(wallet, rideId, effect, 'go')) };
  };
  const driver = Keypair.generate().publicKey.toBase58(), fan = Keypair.generate().publicKey.toBase58();

  it('an order to the DRIVER at the effect\'s price + the unsigned transfer with the order\'s memo; nothing in the feed yet', async () => {
    const { ctx, order } = setup();
    const ride = await ctx.paidRide(driver, true);
    const o = await order(fan, ride.id);
    expect(o.order).toMatchObject({ effect: 'night', lamports: EFFECTS.night.lamports, to: driver, memo: `fc-donation:${o.order.id}` });
    expect(o.transaction.transaction.length).toBeGreaterThan(50);
    expect((await ctx.donationOrders.findById(o.order.id))?.status).toBe('pending');
    expect(await ctx.rideEvents.listAfter(ride.id, 0, 10)).toEqual([]);
  });

  it('refuses an effect whose window is visibly taken (nobody pays for what can\'t happen); a tip is fine; mock servers take no orders', async () => {
    const { ctx, order } = setup();
    const ride = await ctx.paidRide(driver, true);
    await ctx.rideEvents.insert(RideEvent.donation({ rideId: ride.id, wallet: 'x', effect: 'day', now: ctx.now() }), 20_000);
    ctx.clock.advance(5);
    await expect(order(fan, ride.id)).rejects.toBeInstanceOf(TooManyRequestsError);
    expect((await order(fan, ride.id, 'tip')).order.effect).toBe('tip');
    const mock = setup(true);
    const r2 = await mock.ctx.paidRide(driver, true);
    await expect(mock.order(fan, r2.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses orders on free rides (streams and live interactions are disabled)', async () => {
    const { ctx, order } = setup();
    const ride = await ctx.freeRide(driver, true);
    await expect(order(fan, ride.id)).rejects.toThrow(new ForbiddenError('stream watching and interactions are not available on free rides', 'free_ride_no_stream'));
  });
});
