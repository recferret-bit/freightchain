import { GetTicketOrderHandler } from '../../../../../src/application/use-cases/tickets/get-ticket-order/get-ticket-order.handler.js';
import { GetTicketOrderQuery } from '../../../../../src/application/use-cases/tickets/get-ticket-order/get-ticket-order.query.js';
import { TicketOrder } from '../../../../../src/domain/economy/ticket-order.entity.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

describe('GetTicketOrderHandler', () => {
  it('the wallet\'s own order; someone else\'s or a missing one is 404', async () => {
    const ctx = unitContext();
    await ctx.orders.insert(TicketOrder.create({ id: 'o1', wallet: 'w', pool: aPool({ id: 1 }, ctx.now()), qty: 1, walletBought: 0, now: ctx.now() }));
    const handler = new GetTicketOrderHandler(ctx.orders, ctx.rules);
    expect(await handler.execute(new GetTicketOrderQuery('w', 'o1'))).toMatchObject({ id: 'o1', status: 'awaiting_payment', lamports: 50_000_000 });
    await expect(handler.execute(new GetTicketOrderQuery('other', 'o1'))).rejects.toThrow(new NotFoundError('no such order'));
    await expect(handler.execute(new GetTicketOrderQuery('w', 'o2'))).rejects.toBeInstanceOf(NotFoundError);
  });
});
