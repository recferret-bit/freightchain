import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ticketOrderResponse, pendingTicketResponse, ticketPaymentResponse, confirmTicketResponse, reconcileTicketResponse } from '../common/response/economy.response.js';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { TicketOrderDto } from '../../domain/economy/ticket-order.dto.js';
import { CreateTicketOrderCommand } from '../../application/use-cases/tickets/create-ticket-order/create-ticket-order.command.js';
import { GetPendingTicketOrderQuery, type PendingTicketOrderDto } from '../../application/use-cases/tickets/get-pending-ticket-order/get-pending-ticket-order.query.js';
import { GetTicketOrderQuery } from '../../application/use-cases/tickets/get-ticket-order/get-ticket-order.query.js';
import { ConfirmTicketOrderCommand, type ConfirmTicketOrderResultDto } from '../../application/use-cases/tickets/confirm-ticket-order/confirm-ticket-order.command.js';
import { ReconcileTicketOrderCommand, type ReconcileTicketOrderResultDto } from '../../application/use-cases/tickets/reconcile-ticket-order/reconcile-ticket-order.command.js';
import { GetTicketPaymentQuery, type TicketPaymentDto } from '../../application/use-cases/tickets/get-ticket-payment/get-ticket-payment.query.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import {
  confirmTicketOrderBodySchema, createTicketOrderBodySchema, orderIdParamsSchema,
  type ConfirmTicketOrderBody, type CreateTicketOrderBody, type OrderIdParams,
} from './dto/pools.dto.js';

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
  @ZodResponse(ticketOrderResponse)
  create(@CurrentPlayer() player: PlayerIdentity, @ZodBody(createTicketOrderBodySchema) body: CreateTicketOrderBody): Promise<TicketOrderDto> {
    return this.commandBus.execute<CreateTicketOrderCommand, TicketOrderDto>(new CreateTicketOrderCommand(player.wallet, body.poolId, body.qty));
  }

  @Get('pending')
  @ZodResponse(pendingTicketResponse)
  pending(@CurrentPlayer() player: PlayerIdentity): Promise<PendingTicketOrderDto> {
    return this.queryBus.execute<GetPendingTicketOrderQuery, PendingTicketOrderDto>(new GetPendingTicketOrderQuery(player.wallet));
  }

  @Get('orders/:id')
  @ZodResponse(ticketOrderResponse)
  order(@CurrentPlayer() player: PlayerIdentity, @ZodParams(orderIdParamsSchema) params: OrderIdParams): Promise<TicketOrderDto> {
    return this.queryBus.execute<GetTicketOrderQuery, TicketOrderDto>(new GetTicketOrderQuery(player.wallet, params.id));
  }

  /** The unsigned buy_ticket transaction (fresh blockhash each call): the wallet signs AND sends it (it pays its own network fee and the Ticket rent), then /confirm. 409 order closed. */
  @Get('orders/:id/payment')
  @ZodResponse(ticketPaymentResponse)
  payment(@CurrentPlayer() player: PlayerIdentity, @ZodParams(orderIdParamsSchema) params: OrderIdParams): Promise<TicketPaymentDto> {
    return this.queryBus.execute<GetTicketPaymentQuery, TicketPaymentDto>(new GetTicketPaymentQuery(player.wallet, params.id));
  }

  /** 200 `{status:'paid'}` or `{status:'pending'}` (ask again) · 400 the transaction failed or does not pay this order. */
  @Post('orders/:id/confirm') @HttpCode(200)
  @ZodResponse(confirmTicketResponse)
  confirm(@CurrentPlayer() player: PlayerIdentity, @ZodParams(orderIdParamsSchema) params: OrderIdParams, @ZodBody(confirmTicketOrderBodySchema) body: ConfirmTicketOrderBody): Promise<ConfirmTicketOrderResultDto> {
    return this.commandBus.execute<ConfirmTicketOrderCommand, ConfirmTicketOrderResultDto>(new ConfirmTicketOrderCommand(player.wallet, params.id, body.signature));
  }

  /** The phone paid: look the transaction up by the order's reference key. */
  @Post('orders/:id/reconcile') @HttpCode(200)
  @ZodResponse(reconcileTicketResponse)
  reconcile(@CurrentPlayer() player: PlayerIdentity, @ZodParams(orderIdParamsSchema) params: OrderIdParams): Promise<ReconcileTicketOrderResultDto> {
    return this.commandBus.execute<ReconcileTicketOrderCommand, ReconcileTicketOrderResultDto>(new ReconcileTicketOrderCommand(player.wallet, params.id));
  }
}
