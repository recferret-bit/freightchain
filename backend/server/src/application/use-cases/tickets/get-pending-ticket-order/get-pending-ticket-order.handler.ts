import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toTicketOrderDto } from '../../../../domain/economy/ticket-order.dto.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { TicketOrderRepositoryPort } from '../../../ports/economy/ticket-order.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { GetPendingTicketOrderQuery, type PendingTicketOrderDto } from './get-pending-ticket-order.query.js';

/** The order the lobby should resume after a reload (paid in another tab, or the wallet popup was closed). */
@QueryHandler(GetPendingTicketOrderQuery)
export class GetPendingTicketOrderHandler implements IQueryHandler<GetPendingTicketOrderQuery, PendingTicketOrderDto> {
  constructor(
    private readonly orders: TicketOrderRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet }: GetPendingTicketOrderQuery): Promise<PendingTicketOrderDto> {
    const ttl = this.rules.get().orderTtlMs;
    const order = await this.orders.findAwaitingByWallet(wallet);
    return { order: order?.isLive(this.clock.now(), ttl) ? toTicketOrderDto(order, ttl) : null };
  }
}
