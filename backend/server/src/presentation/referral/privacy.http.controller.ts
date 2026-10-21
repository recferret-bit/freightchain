import { Controller, HttpCode, Patch, UseGuards } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { SetConvoyPrivacyCommand } from '../../application/referral/convoy.command.js';
import type { ConvoyPrivacyDto } from '../../application/referral/convoy.service.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import { TermsGuard } from '../common/guards/terms.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { convoyPrivacyBodySchema, convoyPrivacyResponse, type ConvoyPrivacyBody } from './dto/convoy.dto.js';

/** Toggles convoy privacy. When `player.convoyHidden` is absent the handler reports `column: 'missing'` and does not invent the column. */
@Controller('api/me')
@UseGuards(PlayerAuthGuard, TermsGuard)
export class PrivacyHttpController {
  constructor(private readonly commandBus: CommandBus) {}

  @Patch('privacy')
  @HttpCode(200)
  @ZodResponse(convoyPrivacyResponse)
  privacy(@CurrentPlayer() player: PlayerIdentity, @ZodBody(convoyPrivacyBodySchema) body: ConvoyPrivacyBody): Promise<ConvoyPrivacyDto> {
    return this.commandBus.execute<SetConvoyPrivacyCommand, ConvoyPrivacyDto>(new SetConvoyPrivacyCommand(player.wallet, body.convoyHidden));
  }
}
