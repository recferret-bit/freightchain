import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { PledgeDto } from '../../domain/economy/pledge.dto.js';
import { CreatePledgeCommand } from '../../application/use-cases/pledges/create-pledge/create-pledge.command.js';
import { SettlePledgeCommand } from '../../application/use-cases/pledges/settle-pledge/settle-pledge.command.js';
import { GetRidePledgesQuery } from '../../application/use-cases/pledges/get-ride-pledges/get-ride-pledges.query.js';
import { GetPledgeQuery } from '../../application/use-cases/pledges/get-pledge/get-pledge.query.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import type { PlayerAuthPayload } from '../../infrastructure/http/types/http-request.js';
import {
  createPledgeBodySchema,
  pledgeIdParamsSchema,
  pledgeRideIdParamsSchema,
  settlePledgeBodySchema,
  type CreatePledgeDto,
  type PledgeIdParams,
  type PledgeRideIdParams,
  type SettlePledgeBody,
} from './dto/pledges.dto.js';

@Controller('api')
export class PledgesHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('pledges') @HttpCode(200) @UseGuards(PlayerAuthGuard)
  create(@CurrentPlayer() player: PlayerAuthPayload, @ZodBody(createPledgeBodySchema) body: CreatePledgeDto): Promise<PledgeDto> {
    return this.commandBus.execute<CreatePledgeCommand, PledgeDto>(
      new CreatePledgeCommand(player.wallet, body.rideId, body.lamportsPerKm, body.targetKm),
    );
  }

  @Get('rides/:id/pledges')
  listByRide(@ZodParams(pledgeRideIdParamsSchema) params: PledgeRideIdParams): Promise<PledgeDto[]> {
    return this.queryBus.execute<GetRidePledgesQuery, PledgeDto[]>(new GetRidePledgesQuery(params.id));
  }

  @Post('pledges/:id/settle') @HttpCode(200) @UseGuards(PlayerAuthGuard)
  settle(@ZodParams(pledgeIdParamsSchema) params: PledgeIdParams, @ZodBody(settlePledgeBodySchema) body: SettlePledgeBody): Promise<PledgeDto> {
    return this.commandBus.execute<SettlePledgeCommand, PledgeDto>(
      new SettlePledgeCommand(params.id, body.signature, body.slot),
    );
  }

  @Get('pledges/:id')
  get(@ZodParams(pledgeIdParamsSchema) params: PledgeIdParams): Promise<PledgeDto> {
    return this.queryBus.execute<GetPledgeQuery, PledgeDto>(new GetPledgeQuery(params.id));
  }
}
