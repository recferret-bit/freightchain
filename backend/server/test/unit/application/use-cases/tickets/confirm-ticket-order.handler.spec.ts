import { ConfirmTicketOrderHandler } from '../../../../../src/application/use-cases/tickets/confirm-ticket-order/confirm-ticket-order.handler.js';
import { ConfirmTicketOrderCommand } from '../../../../../src/application/use-cases/tickets/confirm-ticket-order/confirm-ticket-order.command.js';
import { BadRequestError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { paymentSetup } from './ticket-payment.support.js';

describe('ConfirmTicketOrderHandler', () => {
  const setup = async () => {
    const s = await paymentSetup();
    const h = new ConfirmTicketOrderHandler(s.ctx.orders, s.bus, s.rules);
    return { ...s, confirm: (sig: string, wallet = s.wallet) => h.execute(new ConfirmTicketOrderCommand(wallet, s.order.id, sig)) };
  };

  it('settles the signature now: the order is paid and the tickets credited; asking again answers paid without a new read', async () => {
    const s = await setup();
    const sig = s.ctx.poolChain.addTransaction([s.purchaseOf(s.order.id)]);
    expect(await s.confirm(sig)).toMatchObject({ status: 'paid', order: { id: s.order.id, status: 'paid', signature: sig } });
    expect((await s.ctx.tickets.find(s.wallet, 1))?.balance).toBe(2);
    const reads = s.ctx.poolChain.readCount;
    expect((await s.confirm(sig)).status).toBe('paid');
    expect(s.ctx.poolChain.readCount).toBe(reads);
  });

  it('not visible yet → pending; failed → 400; a transaction that pays something else → 400 (its purchase is still credited)', async () => {
    const s = await setup();
    s.ctx.poolChain.events.set('later', 'pending');
    expect(await s.confirm('later')).toMatchObject({ status: 'pending', order: { status: 'awaiting_payment' } });
    s.ctx.poolChain.events.set('bad', { invalid: 'transaction failed' });
    await expect(s.confirm('bad')).rejects.toThrow(new BadRequestError('that transaction did not buy tickets: transaction failed', 'transaction_invalid'));
    const other = s.ctx.poolChain.addTransaction([s.purchaseOf('', { qty: 1, lamports: 50_000_000, ticketsSold: 1, activated: false })]);
    await expect(s.confirm(other)).rejects.toMatchObject({ errorCode: 'transaction_mismatch' });
    expect((await s.ctx.tickets.find(s.wallet, 1))?.balance).toBe(1);
  });

  it('someone else\'s order is 404', async () => {
    const s = await setup();
    await expect(s.confirm('x', 'other')).rejects.toThrow(new NotFoundError('no such order'));
  });
});
