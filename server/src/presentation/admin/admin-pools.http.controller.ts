import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { ChallengeDto } from '../../application/use-cases/auth/request-challenge/request-challenge.command.js';
import { HoldPoolPayoutCommand, type PoolHoldDto } from '../../application/use-cases/admin/hold-pool-payout/hold-pool-payout.command.js';
import { ListPoolPayoutsQuery, type PoolPayoutsDto } from '../../application/use-cases/admin/list-pool-payouts/list-pool-payouts.query.js';
import { RequestActionChallengeCommand } from '../../application/use-cases/admin/request-action-challenge/request-action-challenge.command.js';
import { CurrentRequestId } from '../../infrastructure/http/decorators/client-info.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { AdminGuard } from '../../infrastructure/http/guards/admin.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import {
  poolHoldBodySchema, poolHoldChallengeBodySchema, poolHoldParamsSchema, type PoolHoldBody, type PoolHoldChallengeBody, type PoolHoldParams,
} from './dto/admin-pools.dto.js';

/** The PAYOUTS tab of the admin page: the winners list of every pool, and the signed HOLD that stops its automatic payout. Same guard as the rest of /api/admin. */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminPoolsHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('pool-payouts')
  payouts(): Promise<PoolPayoutsDto> {
    return this.queryBus.execute<ListPoolPayoutsQuery, PoolPayoutsDto>(new ListPoolPayoutsQuery());
  }

  @Post('pools/:id/hold/challenge') @HttpCode(200)
  holdChallenge(@CurrentPlayer() admin: PlayerIdentity, @ZodParams(poolHoldParamsSchema) params: PoolHoldParams, @ZodBody(poolHoldChallengeBodySchema) body: PoolHoldChallengeBody): Promise<ChallengeDto> {
    return this.commandBus.execute<RequestActionChallengeCommand, ChallengeDto>(new RequestActionChallengeCommand(admin.wallet, { action: 'pool_hold', poolId: params.id, hold: body.hold, note: body.note }));
  }

  @Post('pools/:id/hold') @HttpCode(200)
  hold(@CurrentPlayer() admin: PlayerIdentity, @ZodParams(poolHoldParamsSchema) params: PoolHoldParams, @ZodBody(poolHoldBodySchema) body: PoolHoldBody, @CurrentRequestId() requestId: string): Promise<PoolHoldDto> {
    return this.commandBus.execute<HoldPoolPayoutCommand, PoolHoldDto>(new HoldPoolPayoutCommand(admin.wallet, params.id, body.hold, body.note, requestId, body.signature));
  }
}
