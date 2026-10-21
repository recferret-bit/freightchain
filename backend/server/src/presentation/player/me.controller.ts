import { Controller, Get, UseGuards } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { GetMyDonationsQuery } from '../../application/live/get-my-donations.query.js';
import type { MyDonationsDto } from '../../application/live/get-my-donations.handler.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import { TermsGuard } from '../common/guards/terms.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { myDonationsResponse } from '../common/response/live.response.js';

/** The signed-in player's tip history. Chat and tips are not on a ride that is still running. */
@Controller('api')
export class MeController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('me/donations')
  @UseGuards(PlayerAuthGuard, TermsGuard)
  @ZodResponse(myDonationsResponse)
  donations(@CurrentPlayer() player: PlayerIdentity): Promise<MyDonationsDto> {
    return this.queryBus.execute<GetMyDonationsQuery, MyDonationsDto>(new GetMyDonationsQuery(player.wallet));
  }
}
