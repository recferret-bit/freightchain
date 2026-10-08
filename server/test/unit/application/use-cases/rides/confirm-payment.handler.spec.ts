import { ConfirmPaymentHandler } from '../../../../../src/application/use-cases/rides/confirm-payment/confirm-payment.handler.js';
import { ConfirmPaymentCommand } from '../../../../../src/application/use-cases/rides/confirm-payment/confirm-payment.command.js';
import { RulesConfigPort } from '../../../../../src/application/ports/config/rules-config.port.js';
import { toRideDto } from '../../../../../src/domain/rides/ride.dto.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { BadRequestError, ConflictError } from '../../../../../src/domain/shared/errors.js';
import { newSignature } from '../../../../support/fake-chain.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';
import { unitContext } from '../../../../support/unit-context.js';

const setup = () => {
  const ctx = unitContext();
  const analytics = new RecordingAnalytics();
  const handler = new ConfirmPaymentHandler(ctx.lookup, ctx.payments, ctx.chain, ctx.settlement, ctx.rules, ctx.clock, analytics);
  return { ctx, analytics, confirm: (id: string, signature: string, wallet = 'w') => handler.execute(new ConfirmPaymentCommand(wallet, id, signature)) };
};

describe('ConfirmPaymentHandler', () => {
  it('pending until the transaction is visible, then paid – and idempotent for the same signature', async () => {
    const { ctx, analytics, confirm } = setup();
    const order = await ctx.paidOrder('w');
    const sig = newSignature();
    expect(await confirm(order.id, sig)).toEqual({ status: 'pending' });
    expect(analytics.events).toEqual([]);
    ctx.chain.txs.set(sig, { outcome: 'success', feePayer: 'w', feePayerSigned: true, transfers: [{ source: 'w', destination: ctx.rules.get().treasury, lamports: order.lamports }], memos: [order.id] });
    expect(await confirm(order.id, sig)).toMatchObject({ status: 'paid', ride: { status: 'created', roundId: 1 } });
    expect(analytics.named('payment_confirmed')).toHaveLength(1);
    expect(analytics.named('payment_confirmed')[0]).toMatchObject({
      dedupeKey: `payment:${sig}`,
      properties: { payment_id: sig, ride_id: order.id, via: 'confirm', lamports: order.lamports, quote_expired: false },
    });
    expect(await confirm(order.id, sig)).toMatchObject({ status: 'paid' });
    expect(analytics.named('payment_confirmed')).toHaveLength(1);
    expect(analytics.named('payment_rejected')).toEqual([]);
  });

  it('a transaction that does not pay this order is a 400 with the reason', async () => {
    const { ctx, analytics, confirm } = setup();
    const order = await ctx.paidOrder('w');
    const sig = ctx.chain.addPayment({ payer: 'w', lamports: order.lamports - 1, memo: order.id });
    await expect(confirm(order.id, sig)).rejects.toThrow(new BadRequestError('no transfer of the ordered amount from your wallet to the treasury'));
    expect(analytics.named('payment_rejected')).toHaveLength(1);
    expect(analytics.named('payment_rejected')[0]).toMatchObject({
      dedupeKey: `payment:${sig}:rejected:amount`,
      properties: { reason_code: 'amount', ride_id: order.id, lamports: order.lamports, tier_id: '1h' },
    });
    expect(analytics.named('payment_confirmed')).toEqual([]);
  });

  it('another signature for a paid ride, a signature that paid another ride, a ride not awaiting payment → 409', async () => {
    const { ctx, analytics, confirm } = setup();
    const a = await ctx.paidOrder('w');
    const sigA = ctx.chain.addPayment({ payer: 'w', lamports: a.lamports, memo: a.id });
    await confirm(a.id, sigA);
    const other = newSignature();
    await expect(confirm(a.id, other)).rejects.toThrow(new ConflictError('this ride is already paid'));
    expect(analytics.named('payment_rejected')).toEqual([]);
    expect(analytics.named('payment_conflict')).toMatchObject([{ dedupeKey: `payment:${other}:conflict:already_paid`, properties: { reason_code: 'already_paid' } }]);
    const b = await ctx.paidOrder('w');
    await expect(confirm(b.id, sigA)).rejects.toThrow(new ConflictError('this transaction already paid for a ride'));
    expect(analytics.named('payment_conflict').map((e) => e.properties['reason_code'])).toEqual(['already_paid', 'signature_reused']);
    await expect(confirm((await ctx.freeRide('x')).id, newSignature(), 'x')).rejects.toThrow(new ConflictError('ride is created'));
    expect(analytics.named('payment_conflict').at(-1)?.properties).toMatchObject({ reason_code: 'bad_status' });
    expect(analytics.named('payment_rejected')).toEqual([]);
  });

  it('honours a payment that lands after the quote lapsed', async () => {
    const { ctx, analytics, confirm } = setup();
    const order = await ctx.paidOrder('w');
    const sig = ctx.chain.addPayment({ payer: 'w', lamports: order.lamports, memo: order.id });
    order.expire(ctx.now()); await ctx.rides.save(order);
    ctx.clock.advance(601);
    expect(await confirm(order.id, sig)).toMatchObject({ status: 'paid' });
    expect((await ctx.reload(order.id)).status).toBe(RideStatus.Created);
    expect(analytics.named('payment_confirmed')[0]?.properties).toMatchObject({ quote_expired: true });
  });

  it('a late payment emits the sibling rides this insert closed', async () => {
    const { ctx, analytics, confirm } = setup();
    const order = await ctx.paidOrder('w');
    order.expire(ctx.now()); await ctx.rides.save(order);
    const free = await ctx.freeRide('w');
    const player = await ctx.storedPlayer('w'); player.spendFreeRide(); await ctx.players.save(player);
    const other = await ctx.paidOrder('w');
    const sig = ctx.chain.addPayment({ payer: 'w', lamports: order.lamports, memo: order.id });
    expect(await confirm(order.id, sig)).toMatchObject({ status: 'paid' });
    expect(analytics.named('ride_cancelled')).toMatchObject([{ dedupeKey: `ride:${free.id}:cancelled`, properties: { reason_code: 'replaced_by_paid' } }]);
    expect(analytics.named('ride_expired')).toMatchObject([{ dedupeKey: `ride:${other.id}:expired` }]);
    expect(analytics.named('payment_confirmed')).toHaveLength(1);
    expect(await confirm(order.id, sig)).toMatchObject({ status: 'paid' });
    expect(analytics.named('ride_cancelled')).toHaveLength(1);
    expect(analytics.named('ride_expired')).toHaveLength(1);
    expect(analytics.named('payment_confirmed')).toHaveLength(1);
  });

  it('inserted false emits no payment_confirmed', async () => {
    const ctx = unitContext();
    const analytics = new RecordingAnalytics();
    const order = await ctx.paidOrder('w');
    const sig = ctx.chain.addPayment({ payer: 'w', lamports: order.lamports, memo: order.id });
    const settlement = { settle: async () => ({ ride: toRideDto(order), inserted: false, paidAt: null }) };
    const handler = new ConfirmPaymentHandler(ctx.lookup, ctx.payments, ctx.chain, settlement as never, ctx.rules, ctx.clock, analytics);
    expect(await handler.execute(new ConfirmPaymentCommand('w', order.id, sig))).toMatchObject({ status: 'paid' });
    expect(analytics.named('payment_confirmed')).toEqual([]);
    expect(analytics.named('ride_cancelled')).toEqual([]);
    expect(analytics.named('ride_expired')).toEqual([]);
  });

  it('a throwing capture still returns paid and keeps the payment', async () => {
    const { ctx, analytics, confirm } = setup();
    const order = await ctx.paidOrder('w');
    const sig = ctx.chain.addPayment({ payer: 'w', lamports: order.lamports, memo: order.id });
    analytics.throwOnCapture = true;
    expect(await confirm(order.id, sig)).toMatchObject({ status: 'paid', ride: { id: order.id } });
    expect(await ctx.payments.findBySignature(sig)).toMatchObject({ rideId: order.id });
  });

  it('a factory throw after settle still returns paid', async () => {
    const ctx = unitContext();
    const analytics = new RecordingAnalytics();
    const order = await ctx.paidOrder('w');
    const sig = ctx.chain.addPayment({ payer: 'w', lamports: order.lamports, memo: order.id });
    let reads = 0;
    class BoomRules extends RulesConfigPort {
      get() {
        reads++;
        if (reads > 1) throw new Error('rules boom');
        return ctx.rules.get();
      }
    }
    const handler = new ConfirmPaymentHandler(ctx.lookup, ctx.payments, ctx.chain, ctx.settlement, new BoomRules(), ctx.clock, analytics);
    expect(await handler.execute(new ConfirmPaymentCommand('w', order.id, sig))).toMatchObject({ status: 'paid' });
    expect(await ctx.payments.findBySignature(sig)).toMatchObject({ rideId: order.id });
    expect(analytics.events).toEqual([]);
  });

  it('a factory throw on a bad amount still throws the original 400', async () => {
    const ctx = unitContext();
    const analytics = new RecordingAnalytics();
    const order = await ctx.paidOrder('w');
    const sig = ctx.chain.addPayment({ payer: 'w', lamports: order.lamports - 1, memo: order.id });
    let reads = 0;
    class BoomRules extends RulesConfigPort {
      get() {
        reads++;
        if (reads > 1) throw new Error('rules boom');
        return ctx.rules.get();
      }
    }
    const handler = new ConfirmPaymentHandler(ctx.lookup, ctx.payments, ctx.chain, ctx.settlement, new BoomRules(), ctx.clock, analytics);
    await expect(handler.execute(new ConfirmPaymentCommand('w', order.id, sig))).rejects.toThrow(new BadRequestError('no transfer of the ordered amount from your wallet to the treasury'));
    expect(analytics.named('payment_rejected')).toEqual([]);
  });
});
