import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toTicketOrderDto, type TicketOrderDto } from '../../../../domain/economy/ticket-order.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { TicketOrderRepositoryPort } from '../../../ports/economy/ticket-order.repository.port.js';
import { GetTicketOrderQuery } from './get-ticket-order.query.js';

/** One of the wallet's orders (the lobby polls it until `paid`). Someone else's order is a 404, like a missing one. */
@QueryHandler(GetTicketOrderQuery)
export class GetTicketOrderHandler implements IQueryHandler<GetTicketOrderQuery, TicketOrderDto> {
  constructor(
    private readonly orders: TicketOrderRepositoryPort,
    private readonly rules: RulesConfigPort,
  ) {}

  async execute({ wallet, orderId }: GetTicketOrderQuery): Promise<TicketOrderDto> {
    const order = await this.orders.findById(orderId);
    if (!order || order.wallet !== wallet) throw new NotFoundError('no such order');
    return toTicketOrderDto(order, this.rules.get().orderTtlMs);
  }
}
