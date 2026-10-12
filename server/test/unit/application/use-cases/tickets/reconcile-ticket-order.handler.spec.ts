import { CommandBus } from '@nestjs/cqrs';
import { ReconcileTicketOrderHandler } from '../../../../../src/application/use-cases/tickets/reconcile-ticket-order/reconcile-ticket-order.handler.js';
import { ReconcileTicketOrderCommand } from '../../../../../src/application/use-cases/tickets/reconcile-ticket-order/reconcile-ticket-order.command.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('ReconcileTicketOrderHandler', () => {
  it('404 when the order is not this wallet\'s', async () => {
    const ctx = unitContext();
    const handler = new ReconcileTicketOrderHandler(ctx.orders, ctx.chain, { execute: async () => ({ status: 'pending' }) } as unknown as CommandBus, ctx.rules);
    await expect(handler.execute(new ReconcileTicketOrderCommand('w', '00000000-0000-4000-8000-000000000001'))).rejects.toBeInstanceOf(NotFoundError);
  });
});
