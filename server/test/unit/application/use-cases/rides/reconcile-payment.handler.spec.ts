import { ReconcilePaymentHandler } from '../../../../../src/application/use-cases/rides/reconcile-payment/reconcile-payment.handler.js';
import { ReconcilePaymentCommand } from '../../../../../src/application/use-cases/rides/reconcile-payment/reconcile-payment.command.js';
import { newSignature } from '../../../../support/fake-chain.js';
import { unitContext } from '../../../../support/unit-context.js';

const setup = () => {
  const ctx = unitContext();
  const handler = new ReconcilePaymentHandler(ctx.lookup, ctx.payments, ctx.chain, ctx.settlement, ctx.rules);
  return { ctx, reconcile: (id: string) => handler.execute(new ReconcilePaymentCommand('w', id)) };
};

describe('ReconcilePaymentHandler', () => {
  it('finds the payment in the wallet history by its memo, fetching only that transaction', async () => {
    const { ctx, reconcile } = setup();
    const order = await ctx.paidOrder('w');
    expect(await reconcile(order.id)).toEqual({ status: 'not_found' });
    ctx.chain.addPayment({ payer: 'w', lamports: order.lamports, memo: order.id });
    ctx.chain.addHistory('w', newSignature(), 'unrelated');
    ctx.chain.addHistory('w', newSignature(), null);
    ctx.chain.fetched = 0;
    expect(await reconcile(order.id)).toMatchObject({ status: 'paid', ride: { id: order.id, status: 'created' } });
    expect(ctx.chain.fetched).toBe(1);
    expect(await reconcile(order.id)).toMatchObject({ status: 'paid' }); // idempotent
  });

  it('a memo match that does not pay (too little) stays not_found', async () => {
    const { ctx, reconcile } = setup();
    const order = await ctx.paidOrder('w');
    ctx.chain.addPayment({ payer: 'w', lamports: 1, memo: order.id });
    expect(await reconcile(order.id)).toEqual({ status: 'not_found' });
  });

  it('a ride that is not an order answers with its own status', async () => {
    const { ctx, reconcile } = setup();
    expect(await reconcile((await ctx.freeRide('w')).id)).toMatchObject({ status: 'created' });
  });
});
