import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { createdPledgeResponse, pledgesResponse, pledgeResponse } from '../common/response/economy.response.js';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { PledgeDto } from '../../domain/economy/pledge.dto.js';
import type { CreatedPledgeDto } from '../../application/use-cases/pledges/create-pledge/create-pledge.handler.js';
import { CreatePledgeCommand } from '../../application/use-cases/pledges/create-pledge/create-pledge.command.js';
import { ConfirmPledgeCommand } from '../../application/use-cases/pledges/confirm-pledge/confirm-pledge.command.js';
import { GetRidePledgesQuery } from '../../application/use-cases/pledges/get-ride-pledges/get-ride-pledges.query.js';
import { GetPledgeQuery } from '../../application/use-cases/pledges/get-pledge/get-pledge.query.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import type { PlayerAuthPayload } from '../../infrastructure/http/types/http-request.js';
import {
  createPledgeBodySchema,
  pledgeIdParamsSchema,
  pledgeRideIdParamsSchema,
  confirmPledgeBodySchema,
  type CreatePledgeDto,
  type PledgeIdParams,
  type PledgeRideIdParams,
  type ConfirmPledgeBody,
} from './dto/pledges.dto.js';

@Controller('api')
export class PledgesHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('pledges') @HttpCode(200) @UseGuards(PlayerAuthGuard)
  @ZodResponse(createdPledgeResponse)
  create(@CurrentPlayer() player: PlayerAuthPayload, @ZodBody(createPledgeBodySchema) body: CreatePledgeDto): Promise<CreatedPledgeDto> {
    return this.commandBus.execute<CreatePledgeCommand, CreatedPledgeDto>(
      new CreatePledgeCommand(player.wallet, body.rideId, body.lamportsPerKm, body.targetKm),
    );
  }

  @Get('rides/:id/pledges')
  @ZodResponse(pledgesResponse)
  listByRide(@ZodParams(pledgeRideIdParamsSchema) params: PledgeRideIdParams): Promise<PledgeDto[]> {
    return this.queryBus.execute<GetRidePledgesQuery, PledgeDto[]>(new GetRidePledgesQuery(params.id));
  }

  /** the sponsor's wallet sent the create_pledge: the server reads that transaction's events (settling and refunding are the pledge job's, on chain) */
  @Post('pledges/:id/confirm') @HttpCode(200) @UseGuards(PlayerAuthGuard)
  @ZodResponse(pledgeResponse)
  confirm(@CurrentPlayer() player: PlayerAuthPayload, @ZodParams(pledgeIdParamsSchema) params: PledgeIdParams, @ZodBody(confirmPledgeBodySchema) body: ConfirmPledgeBody): Promise<PledgeDto> {
    return this.commandBus.execute<ConfirmPledgeCommand, PledgeDto>(new ConfirmPledgeCommand(player.wallet, params.id, body.signature));
  }

  @Get('pledges/:id')
  @ZodResponse(pledgeResponse)
  get(@ZodParams(pledgeIdParamsSchema) params: PledgeIdParams): Promise<PledgeDto> {
    return this.queryBus.execute<GetPledgeQuery, PledgeDto>(new GetPledgeQuery(params.id));
  }
}
