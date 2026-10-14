import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { PendingRideDto, RideDto } from '../../domain/rides/ride.dto.js';
import { ConfirmPaymentCommand, type ConfirmPaymentResultDto } from '../../application/use-cases/rides/confirm-payment/confirm-payment.command.js';
import { CreateRideCommand } from '../../application/use-cases/rides/create-ride/create-ride.command.js';
import { EndRideCommand } from '../../application/use-cases/rides/end-ride/end-ride.command.js';
import { GetPaymentInstructionsQuery, type PaymentInstructionsDto } from '../../application/use-cases/rides/get-payment-instructions/get-payment-instructions.query.js';
import { GetPendingRideQuery } from '../../application/use-cases/rides/get-pending-ride/get-pending-ride.query.js';
import { GetRideQuery } from '../../application/use-cases/rides/get-ride/get-ride.query.js';
import { HeartbeatRideCommand } from '../../application/use-cases/rides/heartbeat-ride/heartbeat-ride.command.js';
import { ReconcilePaymentCommand, type ReconcilePaymentResultDto } from '../../application/use-cases/rides/reconcile-payment/reconcile-payment.command.js';
import { StartRideCommand } from '../../application/use-cases/rides/start-ride/start-ride.command.js';
import { UploadBatchCommand } from '../../application/use-cases/telemetry/upload-batch/upload-batch.command.js';
import { GetRideReplaysQuery } from '../../application/use-cases/verdict/get-ride-replays/get-ride-replays.query.js';
import type { RideReplaysDto } from '../../domain/verdict/ride-replay.entity.js';
import type { BatchBody } from '../../domain/telemetry/ride-batch.entity.js';
import type { BatchReceiptDto } from '../../domain/telemetry/telemetry.dto.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { rideIdParamsSchema, type RideIdParams } from '../common/dto/common.dto.js';
import {
  batchBodySchema, confirmPaymentBodySchema, createRideBodySchema, endRideBodySchema, heartbeatBodySchema, startRideBodySchema,
  type ConfirmPaymentBody, type CreateRideBody, type EndRideBody, type HeartbeatBody, type StartRideBody,
} from './dto/rides.dto.js';

/** A rider's rides: order / get one, pay for it, start it, report progress, end it. Everything is private to the signed-in wallet. */
@Controller('api/rides')
@UseGuards(PlayerAuthGuard)
export class RidesHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post() @HttpCode(200)
  create(@CurrentPlayer() player: PlayerIdentity, @ZodBody(createRideBodySchema) body: CreateRideBody): Promise<RideDto> {
    return this.commandBus.execute<CreateRideCommand, RideDto>(new CreateRideCommand(player.wallet, body.tier, body.tutorial === true, body.assist === true, body.level ?? null));
  }

  /** The paid order the wallet is still owed (declared before :id so "pending" is not read as a ride id). */
  @Get('pending')
  pending(@CurrentPlayer() player: PlayerIdentity): Promise<PendingRideDto> {
    return this.queryBus.execute<GetPendingRideQuery, PendingRideDto>(new GetPendingRideQuery(player.wallet));
  }

  @Get(':id')
  get(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams): Promise<RideDto> {
    return this.queryBus.execute<GetRideQuery, RideDto>(new GetRideQuery(player.wallet, params.id));
  }

  @Get(':id/replays')
  replays(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams): Promise<RideReplaysDto> {
    return this.queryBus.execute<GetRideReplaysQuery, RideReplaysDto>(new GetRideReplaysQuery(player.wallet, params.id));
  }

  @Get(':id/payment')
  payment(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams): Promise<PaymentInstructionsDto> {
    return this.queryBus.execute<GetPaymentInstructionsQuery, PaymentInstructionsDto>(new GetPaymentInstructionsQuery(player.wallet, params.id));
  }

  /** 200 `{status:'paid', ride}` or `{status:'pending'}` (not on chain yet – ask again) · 400 the transaction does not pay this ride · 409 already used. */
  @Post(':id/confirm') @HttpCode(200)
  confirm(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodBody(confirmPaymentBodySchema) body: ConfirmPaymentBody): Promise<ConfirmPaymentResultDto> {
    return this.commandBus.execute<ConfirmPaymentCommand, ConfirmPaymentResultDto>(new ConfirmPaymentCommand(player.wallet, params.id, body.signature));
  }

  /** The payment was sent but confirm never arrived (tab closed…): search the wallet's recent transactions for it. */
  @Post(':id/reconcile') @HttpCode(200)
  reconcile(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams): Promise<ReconcilePaymentResultDto> {
    return this.commandBus.execute<ReconcilePaymentCommand, ReconcilePaymentResultDto>(new ReconcilePaymentCommand(player.wallet, params.id));
  }

  /** body `{ trip? }`: the trip the game built its road from – another one (the ride was re-chosen in the lobby meanwhile) = 409 `ride_rechosen` */
  @Post(':id/start') @HttpCode(200)
  start(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodBody(startRideBodySchema) body: StartRideBody): Promise<RideDto> {
    return this.commandBus.execute<StartRideCommand, RideDto>(new StartRideCommand(player.wallet, params.id, body.trip ?? null));
  }

  @Post(':id/heartbeat') @HttpCode(200)
  heartbeat(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodBody(heartbeatBodySchema) report: HeartbeatBody): Promise<RideDto> {
    return this.commandBus.execute<HeartbeatRideCommand, RideDto>(new HeartbeatRideCommand(player.wallet, params.id, report));
  }

  /** One ~15 s recording batch (input events + 10 Hz samples), hash-chained to the previous one. Taken while the ride runs and for a minute after it ended; a re-sent seq is a no-op. */
  @Post(':id/batches') @HttpCode(200)
  batch(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodBody(batchBodySchema) body: BatchBody): Promise<BatchReceiptDto> {
    return this.commandBus.execute<UploadBatchCommand, BatchReceiptDto>(new UploadBatchCommand(player.wallet, params.id, body));
  }

  @Post(':id/end') @HttpCode(200)
  end(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodBody(endRideBodySchema) body: EndRideBody): Promise<RideDto> {
    return this.commandBus.execute<EndRideCommand, RideDto>(new EndRideCommand(player.wallet, params.id, body.outcome, body.report, body.reason));
  }
}
