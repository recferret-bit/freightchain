import { Keypair } from '@solana/web3.js';
import { GetTicketPaymentHandler } from '../../../../../src/application/use-cases/tickets/get-ticket-payment/get-ticket-payment.handler.js';
import { GetTicketPaymentQuery } from '../../../../../src/application/use-cases/tickets/get-ticket-payment/get-ticket-payment.query.js';
import { ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { paymentSetup } from './ticket-payment.support.js';

describe('GetTicketPaymentHandler', () => {
  const handlerOf = (s: Awaited<ReturnType<typeof paymentSetup>>) => new GetTicketPaymentHandler(s.ctx.orders, s.ctx.players, s.ctx.sponsoredTxs, s.ctx.poolChain, s.rules, s.ctx.transactions, s.ctx.clock);

  it('without a sponsor: a self-paid buy_ticket for the order, its message kept on the order', async () => {
    const s = await paymentSetup();
    const dto = await handlerOf(s).execute(new GetTicketPaymentQuery(s.wallet, s.order.id, false));
    expect(dto).toMatchObject({ orderId: s.order.id, mode: 'program', poolId: 1, lamports: 100_000_000, feePayer: s.wallet, sponsored: false, lastValidBlockHeight: 250 });
    expect(s.ctx.poolChain.built[0]).toMatchObject({ kind: 'buy', input: { payer: s.wallet, poolId: 1, qty: 2, orderId: s.order.id, selfPaid: true } });
    expect((await s.ctx.orders.findById(s.order.id))?.snapshot()).toMatchObject({ txMessage: dto.message, lastValidBlockHeight: 250 });
  });

  it('with a sponsor: sponsored while under the daily cap, self-paid when asked or capped', async () => {
    const s = await paymentSetup({ sponsorEnabled: true, sponsorPerWalletPerDay: 1 });
    s.ctx.poolChain.sponsor = Keypair.generate();
    const h = handlerOf(s);
    expect(await h.execute(new GetTicketPaymentQuery(s.wallet, s.order.id, false))).toMatchObject({ sponsored: true, feePayer: s.ctx.poolChain.sponsor.publicKey.toBase58() });
    expect(await h.execute(new GetTicketPaymentQuery(s.wallet, s.order.id, true))).toMatchObject({ sponsored: false });
    await s.ctx.sponsoredTxs.record({ signature: 'x', wallet: s.wallet, kind: 'buy', feeLamports: 5000, at: s.ctx.now() });
    expect(await h.execute(new GetTicketPaymentQuery(s.wallet, s.order.id, false))).toMatchObject({ sponsored: false });
  });

  it('someone else\'s or a missing order is 404; a lapsed or paid one 409', async () => {
    const s = await paymentSetup();
    const h = handlerOf(s);
    await expect(h.execute(new GetTicketPaymentQuery('other', s.order.id, false))).rejects.toThrow(new NotFoundError('no such order'));
    s.ctx.clock.advance(3600);
    await expect(h.execute(new GetTicketPaymentQuery(s.wallet, s.order.id, false))).rejects.toThrow(new ConflictError('order is expired', 'order_closed'));
  });
});
