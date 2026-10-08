import { GetPendingTicketOrderHandler } from '../../../../../src/application/use-cases/tickets/get-pending-ticket-order/get-pending-ticket-order.handler.js';
import { GetPendingTicketOrderQuery } from '../../../../../src/application/use-cases/tickets/get-pending-ticket-order/get-pending-ticket-order.query.js';
import { TicketOrder } from '../../../../../src/domain/economy/ticket-order.entity.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

describe('GetPendingTicketOrderHandler', () => {
  it('the live unpaid order, null once it lapsed or when there is none', async () => {
    const ctx = unitContext();
    const handler = new GetPendingTicketOrderHandler(ctx.orders, ctx.rules, ctx.clock);
    expect(await handler.execute(new GetPendingTicketOrderQuery('w'))).toEqual({ order: null });
    await ctx.orders.insert(TicketOrder.create({ id: 'o1', wallet: 'w', pool: aPool({ id: 1 }, ctx.now()), qty: 1, walletBought: 0, now: ctx.now() }));
    expect((await handler.execute(new GetPendingTicketOrderQuery('w'))).order).toMatchObject({ id: 'o1' });
    ctx.clock.advance(3600);
    expect(await handler.execute(new GetPendingTicketOrderQuery('w'))).toEqual({ order: null });
  });
});
