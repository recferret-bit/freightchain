import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { TicketOrderDto } from '../../domain/economy/ticket-order.dto.js';
import { CreateTicketOrderCommand } from '../../application/use-cases/tickets/create-ticket-order/create-ticket-order.command.js';
import { GetPendingTicketOrderQuery, type PendingTicketOrderDto } from '../../application/use-cases/tickets/get-pending-ticket-order/get-pending-ticket-order.query.js';
import { GetTicketOrderQuery } from '../../application/use-cases/tickets/get-ticket-order/get-ticket-order.query.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { createTicketOrderBodySchema, orderIdParamsSchema, type CreateTicketOrderBody, type OrderIdParams } from './dto/pools.dto.js';

/** Buying tickets into a pool: an order, then (with the chain adapter) its transaction. Private to the signed-in wallet. */
@Controller('api/tickets')
@UseGuards(PlayerAuthGuard)
export class TicketsHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /** 200 the order (the same one again for the same pool + quantity) · 404 no pool · 409 not sellable · 503 no pool program configured. */
  @Post() @HttpCode(200)
  create(@CurrentPlayer() player: PlayerIdentity, @ZodBody(createTicketOrderBodySchema) body: CreateTicketOrderBody): Promise<TicketOrderDto> {
    return this.commandBus.execute<CreateTicketOrderCommand, TicketOrderDto>(new CreateTicketOrderCommand(player.wallet, body.poolId, body.qty));
  }

  @Get('pending')
  pending(@CurrentPlayer() player: PlayerIdentity): Promise<PendingTicketOrderDto> {
    return this.queryBus.execute<GetPendingTicketOrderQuery, PendingTicketOrderDto>(new GetPendingTicketOrderQuery(player.wallet));
  }

  @Get('orders/:id')
  order(@CurrentPlayer() player: PlayerIdentity, @ZodParams(orderIdParamsSchema) params: OrderIdParams): Promise<TicketOrderDto> {
    return this.queryBus.execute<GetTicketOrderQuery, TicketOrderDto>(new GetTicketOrderQuery(player.wallet, params.id));
  }
}
