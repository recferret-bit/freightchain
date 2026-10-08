import { ReconcilePaymentHandler } from '../../../../../src/application/use-cases/rides/reconcile-payment/reconcile-payment.handler.js';
import { ReconcilePaymentCommand } from '../../../../../src/application/use-cases/rides/reconcile-payment/reconcile-payment.command.js';
import { newSignature } from '../../../../support/fake-chain.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';
import { unitContext } from '../../../../support/unit-context.js';

const setup = () => {
  const ctx = unitContext();
  const analytics = new RecordingAnalytics();
  const handler = new ReconcilePaymentHandler(ctx.lookup, ctx.payments, ctx.chain, ctx.settlement, ctx.rules, ctx.clock, analytics);
  return { ctx, analytics, reconcile: (id: string) => handler.execute(new ReconcilePaymentCommand('w', id)) };
};

describe('ReconcilePaymentHandler', () => {
  it('finds the payment in the wallet history by its memo, fetching only that transaction', async () => {
    const { ctx, analytics, reconcile } = setup();
    const order = await ctx.paidOrder('w');
    expect(await reconcile(order.id)).toEqual({ status: 'not_found' });
    expect(analytics.named('payment_reconcile_missed')).toHaveLength(1);
    expect(analytics.named('payment_rejected')).toEqual([]);
    ctx.chain.addPayment({ payer: 'w', lamports: order.lamports, memo: order.id });
    ctx.chain.addHistory('w', newSignature(), 'unrelated');
    ctx.chain.addHistory('w', newSignature(), null);
    ctx.chain.fetched = 0;
    expect(await reconcile(order.id)).toMatchObject({ status: 'paid', ride: { id: order.id, status: 'created' } });
    expect(ctx.chain.fetched).toBe(1);
    expect(analytics.named('payment_confirmed')).toMatchObject([{ properties: { via: 'reconcile', ride_id: order.id } }]);
    expect(await reconcile(order.id)).toMatchObject({ status: 'paid' }); // idempotent
    expect(analytics.named('payment_confirmed')).toHaveLength(1);
    expect(analytics.named('payment_reconcile_missed')).toHaveLength(1);
  });

  it('a memo match that does not pay (too little) stays not_found', async () => {
    const { ctx, analytics, reconcile } = setup();
    const order = await ctx.paidOrder('w');
    ctx.chain.addPayment({ payer: 'w', lamports: 1, memo: order.id });
    expect(await reconcile(order.id)).toEqual({ status: 'not_found' });
    expect(analytics.named('payment_reconcile_missed')).toHaveLength(1);
    expect(analytics.named('payment_rejected')).toEqual([]);
    expect(analytics.named('payment_confirmed')).toEqual([]);
  });

  it('a second not_found the same UTC day reuses midnight, and the next day does not', async () => {
    const { ctx, analytics, reconcile } = setup();
    const order = await ctx.paidOrder('w');
    expect(await reconcile(order.id)).toEqual({ status: 'not_found' });
    ctx.clock.advance(3_600);
    expect(await reconcile(order.id)).toEqual({ status: 'not_found' });
    const same = analytics.named('payment_reconcile_missed');
    expect(same).toHaveLength(2);
    expect(same[0].timestamp.toISOString()).toBe('2036-10-08T00:00:00.000Z');
    expect(same[1].timestamp.getTime()).toBe(same[0].timestamp.getTime());
    expect(same[0].dedupeKey).toBe(`ride:${order.id}:reconcile-miss:2036-10-08`);
    expect(same[1].dedupeKey).toBe(same[0].dedupeKey);
    ctx.clock.advance(20 * 3_600);
    expect(await reconcile(order.id)).toEqual({ status: 'not_found' });
    const next = analytics.named('payment_reconcile_missed');
    expect(next).toHaveLength(3);
    expect(next[2].timestamp.toISOString()).toBe('2036-10-09T00:00:00.000Z');
    expect(next[2].dedupeKey).toBe(`ride:${order.id}:reconcile-miss:2036-10-09`);
  });

  it('a late match emits the sibling rides this insert closed, and a repeat emits none', async () => {
    const { ctx, analytics, reconcile } = setup();
    const order = await ctx.paidOrder('w');
    order.expire(ctx.now()); await ctx.rides.save(order);
    const free = await ctx.freeRide('w');
    const player = await ctx.storedPlayer('w'); player.spendFreeRide(); await ctx.players.save(player);
    const other = await ctx.paidOrder('w');
    ctx.chain.addPayment({ payer: 'w', lamports: order.lamports, memo: order.id });
    expect(await reconcile(order.id)).toMatchObject({ status: 'paid' });
    expect(analytics.named('ride_cancelled')).toMatchObject([{ dedupeKey: `ride:${free.id}:cancelled`, properties: { reason_code: 'replaced_by_paid' } }]);
    expect(analytics.named('ride_expired')).toMatchObject([{ dedupeKey: `ride:${other.id}:expired` }]);
    expect(analytics.named('payment_confirmed')).toHaveLength(1);
    expect(await reconcile(order.id)).toMatchObject({ status: 'paid' });
    expect(analytics.named('ride_cancelled')).toHaveLength(1);
    expect(analytics.named('ride_expired')).toHaveLength(1);
    expect(analytics.named('payment_confirmed')).toHaveLength(1);
  });

  it('a ride that is not an order answers with its own status', async () => {
    const { ctx, analytics, reconcile } = setup();
    expect(await reconcile((await ctx.freeRide('w')).id)).toMatchObject({ status: 'created' });
    expect(analytics.events).toEqual([]);
  });
});
