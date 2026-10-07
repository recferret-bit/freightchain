import { ConfirmPaymentHandler } from '../../../../../src/application/use-cases/rides/confirm-payment/confirm-payment.handler.js';
import { ConfirmPaymentCommand } from '../../../../../src/application/use-cases/rides/confirm-payment/confirm-payment.command.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { BadRequestError, ConflictError } from '../../../../../src/domain/shared/errors.js';
import { newSignature } from '../../../../support/fake-chain.js';
import { unitContext } from '../../../../support/unit-context.js';

const setup = () => {
  const ctx = unitContext();
  const handler = new ConfirmPaymentHandler(ctx.lookup, ctx.payments, ctx.chain, ctx.settlement, ctx.rules);
  return { ctx, confirm: (id: string, signature: string, wallet = 'w') => handler.execute(new ConfirmPaymentCommand(wallet, id, signature)) };
};

describe('ConfirmPaymentHandler', () => {
  it('pending until the transaction is visible, then paid – and idempotent for the same signature', async () => {
    const { ctx, confirm } = setup();
    const order = await ctx.paidOrder('w');
    const sig = newSignature();
    expect(await confirm(order.id, sig)).toEqual({ status: 'pending' });
    ctx.chain.txs.set(sig, { outcome: 'success', feePayer: 'w', feePayerSigned: true, transfers: [{ source: 'w', destination: ctx.rules.get().treasury, lamports: order.lamports }], memos: [order.id] });
    expect(await confirm(order.id, sig)).toMatchObject({ status: 'paid', ride: { status: 'created', roundId: 1 } });
    expect(await confirm(order.id, sig)).toMatchObject({ status: 'paid' });
  });

  it('a transaction that does not pay this order is a 400 with the reason', async () => {
    const { ctx, confirm } = setup();
    const order = await ctx.paidOrder('w');
    const sig = ctx.chain.addPayment({ payer: 'w', lamports: order.lamports - 1, memo: order.id });
    await expect(confirm(order.id, sig)).rejects.toThrow(new BadRequestError('no transfer of the ordered amount from your wallet to the treasury'));
  });

  it('another signature for a paid ride, a signature that paid another ride, a ride not awaiting payment → 409', async () => {
    const { ctx, confirm } = setup();
    const a = await ctx.paidOrder('w');
    const sigA = ctx.chain.addPayment({ payer: 'w', lamports: a.lamports, memo: a.id });
    await confirm(a.id, sigA);
    await expect(confirm(a.id, newSignature())).rejects.toThrow(new ConflictError('this ride is already paid'));
    const b = await ctx.paidOrder('w');
    await expect(confirm(b.id, sigA)).rejects.toThrow(new ConflictError('this transaction already paid for a ride'));
    await expect(confirm((await ctx.freeRide('x')).id, newSignature(), 'x')).rejects.toThrow(new ConflictError('ride is created'));
  });

  it('honours a payment that lands after the quote lapsed', async () => {
    const { ctx, confirm } = setup();
    const order = await ctx.paidOrder('w');
    const sig = ctx.chain.addPayment({ payer: 'w', lamports: order.lamports, memo: order.id });
    order.expire(ctx.now()); await ctx.rides.save(order);
    expect(await confirm(order.id, sig)).toMatchObject({ status: 'paid' });
    expect((await ctx.reload(order.id)).status).toBe(RideStatus.Created);
  });
});
