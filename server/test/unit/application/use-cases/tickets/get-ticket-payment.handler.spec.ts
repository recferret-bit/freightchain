import { GetTicketPaymentHandler } from '../../../../../src/application/use-cases/tickets/get-ticket-payment/get-ticket-payment.handler.js';
import { GetTicketPaymentQuery } from '../../../../../src/application/use-cases/tickets/get-ticket-payment/get-ticket-payment.query.js';
import { ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { paymentSetup } from './ticket-payment.support.js';

describe('GetTicketPaymentHandler', () => {
  const handlerOf = (s: Awaited<ReturnType<typeof paymentSetup>>) => new GetTicketPaymentHandler(s.ctx.orders, s.ctx.players, s.ctx.poolChain, s.rules, s.ctx.transactions, s.ctx.clock, s.ctx.entropy);

  it('a buy_ticket paid by the wallet itself (fee + Ticket rent), its message kept on the order', async () => {
    const s = await paymentSetup();
    const dto = await handlerOf(s).execute(new GetTicketPaymentQuery(s.wallet, s.order.id));
    expect(dto).toMatchObject({ orderId: s.order.id, mode: 'program', poolId: 1, lamports: 100_000_000, feePayer: s.wallet, lastValidBlockHeight: 250 });
    expect(s.ctx.poolChain.built[0]).toMatchObject({ kind: 'buy', input: { payer: s.wallet, poolId: 1, qty: 2, orderId: s.order.id } });
    expect((await s.ctx.orders.findById(s.order.id))?.snapshot()).toMatchObject({ txMessage: dto.message, lastValidBlockHeight: 250 });
  });

  it('an unsigned buy is refused until both boxes are on', async () => {
    const s = await paymentSetup();
    const player = await s.ctx.storedPlayer(s.wallet);
    player.setAgreements({ age18: false, loss: true }, s.ctx.now());
    await s.ctx.players.save(player);
    await expect(handlerOf(s).execute(new GetTicketPaymentQuery(s.wallet, s.order.id))).rejects.toMatchObject({ errorCode: 'agreements_required' });
  });

  it('someone else\'s or a missing order is 404; a lapsed or paid one 409', async () => {
    const s = await paymentSetup();
    const h = handlerOf(s);
    await expect(h.execute(new GetTicketPaymentQuery('other', s.order.id))).rejects.toThrow(new NotFoundError('no such order'));
    s.ctx.clock.advance(3600);
    await expect(h.execute(new GetTicketPaymentQuery(s.wallet, s.order.id))).rejects.toThrow(new ConflictError('order is expired', 'order_closed'));
  });
});
