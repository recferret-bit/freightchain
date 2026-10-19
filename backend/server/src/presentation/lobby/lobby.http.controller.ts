import { Controller, Get, HttpCode, Put, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { AgreementsDto } from '../../domain/players/player.dto.js';
import type { LiveFeedDto, ProfileDto, ReplaysDto } from '../../domain/lobby/lobby.dto.js';
import { AcceptAgreementsCommand } from '../../application/use-cases/players/accept-agreements/accept-agreements.command.js';
import { GetLiveQuery } from '../../application/use-cases/lobby/get-live/get-live.query.js';
import { GetProfileQuery } from '../../application/use-cases/lobby/get-profile/get-profile.query.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import { OptionalSessionGuard } from '../../infrastructure/http/guards/optional-session.guard.js';
import { OptionalSession } from '../../infrastructure/http/decorators/optional-session.js';
import { CurrentClient } from '../../infrastructure/http/decorators/client-info.js';
import { ZodBody, ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import type { ClientInfo } from '../../domain/auth/sign-in.js';
import { agreementsBodySchema, liveQuerySchema, replaysQuerySchema, type AgreementsBody, type LiveQuery, type ReplaysQuery } from './dto/lobby.dto.js';
import { GetReplaysQuery } from '../../application/use-cases/lobby/get-replays/get-replays.query.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';

@Controller('api')
export class LobbyHttpController {
  constructor(private readonly queryBus: QueryBus, private readonly commandBus: CommandBus) {}

  /** Public – the "who is on the road" feed (poll every ~5 s; no RPC behind it). `visitor` + `page` count the polling page as online; the session cookie,
      when sent, counts it as a signed-in player (OptionalSessionGuard never refuses). */
  @Get('live') @UseGuards(OptionalSessionGuard)
  live(@ZodQuery(liveQuerySchema) query: LiveQuery, @CurrentClient() client: ClientInfo, @OptionalSession() wallet: string | null): Promise<LiveFeedDto> {
    return this.queryBus.execute<GetLiveQuery, LiveFeedDto>(new GetLiveQuery(query.visitor, query.page, client.ip ?? '', wallet, query.leave));
  }

  /** Public – the replays history: rides that ended, newest first, `before`-paged, each saying whether it can still be replayed (play.html?watch=<id>). */
  @Get('replays')
  replays(@ZodQuery(replaysQuerySchema) query: ReplaysQuery): Promise<ReplaysDto> {
    return this.queryBus.execute<GetReplaysQuery, ReplaysDto>(new GetReplaysQuery(query.before, query.limit, query.wallet, query.status));
  }

  @Get('profile') @UseGuards(PlayerAuthGuard)
  profile(@CurrentPlayer() player: PlayerIdentity): Promise<ProfileDto> {
    return this.queryBus.execute<GetProfileQuery, ProfileDto>(new GetProfileQuery(player.wallet));
  }

  /** Both boxes. Off until ticked. A paid shift reads the stamps, not this response. */
  @Put('profile/agreements') @HttpCode(200) @UseGuards(PlayerAuthGuard)
  agreements(@CurrentPlayer() player: PlayerIdentity, @ZodBody(agreementsBodySchema) body: AgreementsBody): Promise<AgreementsDto> {
    return this.commandBus.execute<AcceptAgreementsCommand, AgreementsDto>(new AcceptAgreementsCommand(player.wallet, body.age18, body.loss));
  }
}
