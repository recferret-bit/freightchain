import { CommandBus } from '@nestjs/cqrs';
import { ReconcileDonationHandler } from '../../../../../src/application/use-cases/live/reconcile-donation/reconcile-donation.handler.js';
import { ReconcileDonationCommand } from '../../../../../src/application/use-cases/live/reconcile-donation/reconcile-donation.command.js';
import { DonationOrder } from '../../../../../src/domain/live/donation-order.entity.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('ReconcileDonationHandler', () => {
  it('not_found until a transaction mentions the reference', async () => {
    const ctx = unitContext();
    const order = DonationOrder.create({ id: ctx.entropy.uuid(), rideId: 'ride-1', wallet: 'fan', recipient: 'driver', effect: 'tip', now: ctx.now() });
    order.assignReference(ctx.entropy.referenceKey());
    await ctx.donationOrders.insert(order);
    const handler = new ReconcileDonationHandler(ctx.donationOrders, ctx.chain, { execute: async () => ({ status: 'pending' }) } as unknown as CommandBus);
    expect(await handler.execute(new ReconcileDonationCommand('fan', 'ride-1', order.id))).toEqual({ status: 'not_found' });
  });
});
