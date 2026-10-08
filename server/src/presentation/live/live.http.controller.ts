import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { InboxDto, RideEventDto, WatchDto } from '../../domain/live/live.dto.js';
import { AckEffectCommand } from '../../application/use-cases/live/ack-effect/ack-effect.command.js';
import { GetInboxQuery } from '../../application/use-cases/live/get-inbox/get-inbox.query.js';
import { PostRideEventCommand } from '../../application/use-cases/live/post-ride-event/post-ride-event.command.js';
import { WatchRideQuery } from '../../application/use-cases/live/watch-ride/watch-ride.query.js';
import { CurrentClient } from '../../infrastructure/http/decorators/client-info.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import type { ClientInfo } from '../../domain/auth/sign-in.js';
import { ZodBody, ZodParams, ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { rideIdParamsSchema, type RideIdParams } from '../common/dto/common.dto.js';
import {
  appliedBodySchema, donationBodySchema, effectParamsSchema, inboxQuerySchema, messageBodySchema, watchQuerySchema,
  type AppliedBody, type DonationBody, type EffectParams, type InboxQuery, type MessageBody, type WatchQuery,
} from './dto/live.dto.js';

/**
 * Live streams. Spectators: watch any started ride (PUBLIC – the replay of its recording + the feed, polled every few seconds), and – signed in – write to a
 * running one or donate (MOCK: nothing is charged). The driver's game: polls its inbox and stamps each effect it applied. No WebSockets: everything is a poll.
 */
@Controller('api')
export class LiveHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('watch/:id')
  watch(@ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodQuery(watchQuerySchema) query: WatchQuery, @CurrentClient() client: ClientInfo): Promise<WatchDto> {
    return this.queryBus.execute<WatchRideQuery, WatchDto>(new WatchRideQuery(params.id, query.from, query.after, query.viewer, query.since, client.ip ?? ''));
  }

  @Post('watch/:id/messages') @HttpCode(200) @UseGuards(PlayerAuthGuard)
  message(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodBody(messageBodySchema) body: MessageBody): Promise<RideEventDto> {
    return this.commandBus.execute<PostRideEventCommand, RideEventDto>(new PostRideEventCommand(player.wallet, params.id, { kind: 'message', text: body.text }));
  }

  /** 200 the stored donation · 429 the ride's effect window (or the wallet's line window) is taken · 409 the ride is not live · 403 your own ride. */
  @Post('watch/:id/donations') @HttpCode(200) @UseGuards(PlayerAuthGuard)
  donate(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodBody(donationBodySchema) body: DonationBody): Promise<RideEventDto> {
    return this.commandBus.execute<PostRideEventCommand, RideEventDto>(new PostRideEventCommand(player.wallet, params.id, { kind: 'donation', effect: body.effect, note: body.note }));
  }

  @Get('rides/:id/inbox') @UseGuards(PlayerAuthGuard)
  inbox(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodQuery(inboxQuerySchema) query: InboxQuery): Promise<InboxDto> {
    return this.queryBus.execute<GetInboxQuery, InboxDto>(new GetInboxQuery(player.wallet, params.id, query.after));
  }

  @Post('rides/:id/effects/:eventId/applied') @HttpCode(200) @UseGuards(PlayerAuthGuard)
  applied(@CurrentPlayer() player: PlayerIdentity, @ZodParams(effectParamsSchema) params: EffectParams, @ZodBody(appliedBodySchema) body: AppliedBody): Promise<RideEventDto> {
    return this.commandBus.execute<AckEffectCommand, RideEventDto>(new AckEffectCommand(player.wallet, params.id, params.eventId, body));
  }
}
