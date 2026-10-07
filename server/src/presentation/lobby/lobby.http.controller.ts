import { Controller, Get, UseGuards } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import type { LiveFeedDto, ProfileDto } from '../../domain/lobby/lobby.dto.js';
import { GetLiveQuery } from '../../application/use-cases/lobby/get-live/get-live.query.js';
import { GetProfileQuery } from '../../application/use-cases/lobby/get-profile/get-profile.query.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';

@Controller('api')
export class LobbyHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  /** Public – the "who is on the road" feed (poll every ~5 s; no RPC behind it). */
  @Get('live')
  live(): Promise<LiveFeedDto> {
    return this.queryBus.execute<GetLiveQuery, LiveFeedDto>(new GetLiveQuery());
  }

  @Get('profile') @UseGuards(PlayerAuthGuard)
  profile(@CurrentPlayer() player: PlayerIdentity): Promise<ProfileDto> {
    return this.queryBus.execute<GetProfileQuery, ProfileDto>(new GetProfileQuery(player.wallet));
  }
}
