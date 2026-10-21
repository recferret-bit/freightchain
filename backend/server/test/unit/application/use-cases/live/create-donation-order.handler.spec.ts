import { Keypair } from '@solana/web3.js';
import { CreateDonationOrderHandler } from '../../../../../src/application/use-cases/live/create-donation-order/create-donation-order.handler.js';
import { CreateDonationOrderCommand } from '../../../../../src/application/use-cases/live/create-donation-order/create-donation-order.command.js';
import { TIP_DEFAULT_LAMPORTS, tipSplit } from '../../../../../src/domain/live/tip-rules.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

describe('CreateDonationOrderHandler', () => {
  const driver = Keypair.generate().publicKey.toBase58(), fan = Keypair.generate().publicKey.toBase58();
  const setup = (freeDonations = false) => {
    const ctx = unitContext(unitRules({ live: { chat: 'all', donations: true, freeDonations, effects: 'off' } }));
    const handler = new CreateDonationOrderHandler(ctx.donations, ctx.donationOrders, ctx.chain, ctx.entropy, ctx.clock);
    const finished = async () => {
      const ride = await ctx.paidRide(driver, true);
      ride.finish('failed', 'done', ctx.now());
      return ctx.rides.save(ride);
    };
    const order = (wallet: string, rideId: string, effect: 'tip' | 'night' = 'tip', lamports: number | null = null) => handler.execute(new CreateDonationOrderCommand(wallet, rideId, effect, 'go', lamports));
    return { ctx, finished, order };
  };

  it('a tip order is 95% to the driver and 5% to the treasury, with nothing in the feed yet', async () => {
    const { ctx, finished, order } = setup();
    const ride = await finished();
    const o = await order(fan, ride.id);
    const split = tipSplit(TIP_DEFAULT_LAMPORTS);
    expect(o.order).toMatchObject({ effect: 'tip', lamports: TIP_DEFAULT_LAMPORTS, to: driver, memo: `fc-donation:${o.order.id}` });
    expect(o.transaction.transaction.length).toBeGreaterThan(50);
    const stored = await ctx.donationOrders.findById(o.order.id);
    expect(stored?.shareLamports).toBe(split.treasury);
    expect(stored?.referrer).toBe(ctx.rules.get().treasury);
    expect(await ctx.rideEvents.listAfter(ride.id, 0, 10)).toEqual([]);
  });

  it('refuses a gameplay effect, a running ride, and a mock server', async () => {
    const { ctx, finished, order } = setup();
    const ride = await finished();
    await expect(order(fan, ride.id, 'night')).rejects.toThrow(BadRequestError);
    const running = await ctx.paidRide(driver, true);
    await expect(order(fan, running.id)).rejects.toThrow(NotFoundError);
    const mock = setup(true);
    const replay = await mock.finished();
    await expect(mock.order(fan, replay.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a training ride', async () => {
    const { ctx, order } = setup();
    const ride = await ctx.freeRide(driver, true);
    ride.finish('failed', 'done', ctx.now()); await ctx.rides.save(ride);
    await expect(order(fan, ride.id)).rejects.toMatchObject({ errorCode: 'replay_not_available' });
  });
});
