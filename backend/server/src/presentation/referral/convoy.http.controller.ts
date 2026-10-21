import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { BindConvoyCommand, GetConvoyLeaderboardQuery } from '../../application/referral/convoy.command.js';
import type { ConvoyBindDto, ConvoyLeaderboardDto } from '../../application/referral/convoy.service.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import { TermsGuard } from '../common/guards/terms.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { convoyBindBodySchema, convoyBindResponse, convoyLeaderboardResponse, type ConvoyBindBody } from './dto/convoy.dto.js';

/** Convoy leaderboard and bind. The legacy `/api/referrals/bind` gift path is a different controller. */
@Controller('api/referrals')
@UseGuards(PlayerAuthGuard, TermsGuard)
export class ConvoyHttpController {
  constructor(private readonly commandBus: CommandBus, private readonly queryBus: QueryBus) {}

  @Get('leaderboard')
  @ZodResponse(convoyLeaderboardResponse)
  leaderboard(@CurrentPlayer() player: PlayerIdentity): Promise<ConvoyLeaderboardDto> {
    return this.queryBus.execute<GetConvoyLeaderboardQuery, ConvoyLeaderboardDto>(new GetConvoyLeaderboardQuery(player.wallet));
  }

  @Post('convoy/bind')
  @HttpCode(200)
  @ZodResponse(convoyBindResponse)
  bind(@CurrentPlayer() player: PlayerIdentity, @ZodBody(convoyBindBodySchema) body: ConvoyBindBody): Promise<ConvoyBindDto> {
    return this.commandBus.execute<BindConvoyCommand, ConvoyBindDto>(new BindConvoyCommand(player.wallet, body.code));
  }
}
