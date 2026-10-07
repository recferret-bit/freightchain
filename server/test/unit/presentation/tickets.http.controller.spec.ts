import { TicketsHttpController } from '../../../src/presentation/economy/tickets.http.controller.js';
import { CreateTicketOrderCommand } from '../../../src/application/use-cases/tickets/create-ticket-order/create-ticket-order.command.js';
import { GetPendingTicketOrderQuery } from '../../../src/application/use-cases/tickets/get-pending-ticket-order/get-pending-ticket-order.query.js';
import { GetTicketOrderQuery } from '../../../src/application/use-cases/tickets/get-ticket-order/get-ticket-order.query.js';
import { GetTicketPaymentQuery } from '../../../src/application/use-cases/tickets/get-ticket-payment/get-ticket-payment.query.js';
import { ConfirmTicketOrderCommand } from '../../../src/application/use-cases/tickets/confirm-ticket-order/confirm-ticket-order.command.js';
import { SubmitTicketOrderCommand } from '../../../src/application/use-cases/tickets/submit-ticket-order/submit-ticket-order.command.js';
import { confirmTicketOrderBodySchema, createTicketOrderBodySchema, orderIdParamsSchema, submitTicketOrderBodySchema, ticketPaymentQuerySchema } from '../../../src/presentation/economy/dto/pools.dto.js';
import { busMock } from '../../support/bus.js';

describe('TicketsHttpController', () => {
  it('create → the command, pending / order → their queries, all with the signed-in wallet', async () => {
    const commands = busMock({ id: 'o' }), queries = busMock({ order: null });
    const c = new TicketsHttpController(commands.bus, queries.bus);
    expect(await c.create({ wallet: 'w' }, { poolId: 1, qty: 2 })).toEqual({ id: 'o' });
    expect(commands.last()).toEqual(new CreateTicketOrderCommand('w', 1, 2));
    await c.pending({ wallet: 'w' }); expect(queries.last()).toEqual(new GetPendingTicketOrderQuery('w'));
    await c.order({ wallet: 'w' }, { id: 'x' }); expect(queries.last()).toEqual(new GetTicketOrderQuery('w', 'x'));
    await c.payment({ wallet: 'w' }, { id: 'x' }, { selfPaid: true }); expect(queries.last()).toEqual(new GetTicketPaymentQuery('w', 'x', true));
    await c.confirm({ wallet: 'w' }, { id: 'x' }, { signature: 's' }); expect(commands.last()).toEqual(new ConfirmTicketOrderCommand('w', 'x', 's'));
    await c.submit({ wallet: 'w' }, { id: 'x' }, { signedTransaction: 'AA==' }); expect(commands.last()).toEqual(new SubmitTicketOrderCommand('w', 'x', 'AA=='));
  });

  it('bodies and ids are validated', () => {
    expect(createTicketOrderBodySchema.safeParse({ poolId: 1, qty: 2 }).success).toBe(true);
    for (const b of [{ poolId: 1, qty: 0 }, { poolId: 1, qty: 101 }, { poolId: -1, qty: 1 }, { poolId: '1', qty: 1 }, { poolId: 1 }]) expect(createTicketOrderBodySchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
    expect(orderIdParamsSchema.safeParse({ id: '00000000-0000-4000-8000-000000000001' }).success).toBe(true);
    expect(orderIdParamsSchema.safeParse({ id: 'nope' }).success).toBe(false);
    expect(ticketPaymentQuerySchema.parse({ selfPaid: '1' }).selfPaid).toBe(true);
    expect(ticketPaymentQuerySchema.parse({}).selfPaid).toBe(false);
    expect(confirmTicketOrderBodySchema.safeParse({ signature: 'nope' }).success).toBe(false);
    expect(submitTicketOrderBodySchema.safeParse({ signedTransaction: 'AQID' }).success).toBe(true);
    expect(submitTicketOrderBodySchema.safeParse({ signedTransaction: 'not base64!' }).success).toBe(false);
  });
});
