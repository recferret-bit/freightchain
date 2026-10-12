import { Keypair } from '@solana/web3.js';
import { GetDonationPaymentHandler } from '../../../../../src/application/use-cases/live/get-donation-payment/get-donation-payment.handler.js';
import { GetDonationPaymentQuery } from '../../../../../src/application/use-cases/live/get-donation-payment/get-donation-payment.query.js';
import { DonationOrder } from '../../../../../src/domain/live/donation-order.entity.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetDonationPaymentHandler', () => {
  it('rebuilds the transfer for the spectator, and refuses another wallet', async () => {
    const ctx = unitContext();
    const fan = Keypair.generate().publicKey.toBase58();
    const driver = Keypair.generate().publicKey.toBase58();
    const order = DonationOrder.create({ id: ctx.entropy.uuid(), rideId: 'ride-1', wallet: fan, recipient: driver, effect: 'tip', now: ctx.now() });
    order.assignReference(ctx.entropy.referenceKey());
    await ctx.donationOrders.insert(order);
    const handler = new GetDonationPaymentHandler(ctx.donationOrders, ctx.chain, ctx.entropy);
    const built = await handler.execute(new GetDonationPaymentQuery(fan, order.id));
    expect(built.reference).toBe(order.paymentReference);
    expect(typeof built.transaction).toBe('string');
    await expect(handler.execute(new GetDonationPaymentQuery(driver, order.id))).rejects.toBeInstanceOf(NotFoundError);
  });
});
