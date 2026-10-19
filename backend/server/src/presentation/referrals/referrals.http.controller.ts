import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { BindReferralCommand, GetReferralsQuery, SetReferralGiftCommand } from '../../application/use-cases/referrals/referrals.command.js';
import type { ReferralView } from '../../application/services/referral.service.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { bindReferralBodySchema, giftReferralBodySchema, type BindReferralBody, type GiftReferralBody } from './dto/referrals.dto.js';

/** The lobby's invite block. The signed-in wallet only. */
@Controller('api/referrals')
@UseGuards(PlayerAuthGuard)
export class ReferralsHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  view(@CurrentPlayer() player: PlayerIdentity): Promise<ReferralView> {
    return this.queryBus.execute<GetReferralsQuery, ReferralView>(new GetReferralsQuery(player.wallet));
  }

  /** 200 the view (the same code again is a no-op) · 400 a bad code · 409 own code, already bound, expired, no slots, a ride already started, unknown code. */
  @Post('bind') @HttpCode(200)
  bind(@CurrentPlayer() player: PlayerIdentity, @ZodBody(bindReferralBodySchema) body: BindReferralBody): Promise<ReferralView> {
    return this.commandBus.execute<BindReferralCommand, ReferralView>(new BindReferralCommand(player.wallet, body.code));
  }

  /** 200 the view · 400 an item that is not a referral colour. */
  @Post('gift') @HttpCode(200)
  gift(@CurrentPlayer() player: PlayerIdentity, @ZodBody(giftReferralBodySchema) body: GiftReferralBody): Promise<ReferralView> {
    return this.commandBus.execute<SetReferralGiftCommand, ReferralView>(new SetReferralGiftCommand(player.wallet, body.item));
  }
}
