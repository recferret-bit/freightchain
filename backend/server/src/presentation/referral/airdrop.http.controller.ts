import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ClaimPreseasonAttemptCommand, ClaimAirdropCommand, GetAirdropStatusQuery, VerifyTelegramCommand, VerifyXCommand } from '../../application/airdrop/airdrop.command.js';
import type { AirdropStatusDto } from '../../application/airdrop/airdrop.service.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import { TermsGuard } from '../common/guards/terms.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { claimAttemptBodySchema, type ClaimAttemptBody, airdropStatusResponse, claimAirdropBodySchema, verifyTelegramBodySchema, verifyXBodySchema, type ClaimAirdropBody, type VerifyTelegramBody, type VerifyXBody } from './dto/airdrop.dto.js';

/** Pre-season airdrop. Provider facts and ownership checks live behind application ports. */
@Controller('api/airdrop')
@UseGuards(PlayerAuthGuard, TermsGuard)
export class AirdropHttpController {
  constructor(private readonly commandBus: CommandBus, private readonly queryBus: QueryBus) {}

  @Get('status')
  @ZodResponse(airdropStatusResponse)
  status(@CurrentPlayer() player: PlayerIdentity): Promise<AirdropStatusDto> {
    return this.queryBus.execute<GetAirdropStatusQuery, AirdropStatusDto>(new GetAirdropStatusQuery(player.wallet));
  }

  @Post('verify-telegram')
  @HttpCode(200)
  @ZodResponse(airdropStatusResponse)
  verifyTelegram(@CurrentPlayer() player: PlayerIdentity, @ZodBody(verifyTelegramBodySchema) body: VerifyTelegramBody): Promise<AirdropStatusDto> {
    return this.commandBus.execute<VerifyTelegramCommand, AirdropStatusDto>(new VerifyTelegramCommand(player.wallet, body.telegramUserId, body.turnstileToken, body.proof));
  }

  @Post('verify-x')
  @HttpCode(200)
  @ZodResponse(airdropStatusResponse)
  verifyX(@CurrentPlayer() player: PlayerIdentity, @ZodBody(verifyXBodySchema) body: VerifyXBody): Promise<AirdropStatusDto> {
    return this.commandBus.execute<VerifyXCommand, AirdropStatusDto>(new VerifyXCommand(player.wallet, body.handle, body.postId, body.turnstileToken));
  }

  @Post('preseason/claim-attempt')
  @HttpCode(200)
  @ZodResponse(airdropStatusResponse)
  claimAttempt(@CurrentPlayer() player: PlayerIdentity, @ZodBody(claimAttemptBodySchema) body: ClaimAttemptBody): Promise<AirdropStatusDto> {
    return this.commandBus.execute<ClaimPreseasonAttemptCommand, AirdropStatusDto>(new ClaimPreseasonAttemptCommand(player.wallet, body.acceptedRules, body.turnstileToken));
  }

  @Post('claim')
  @HttpCode(200)
  @ZodResponse(airdropStatusResponse)
  claim(@CurrentPlayer() player: PlayerIdentity, @ZodBody(claimAirdropBodySchema) body: ClaimAirdropBody): Promise<AirdropStatusDto> {
    return this.commandBus.execute<ClaimAirdropCommand, AirdropStatusDto>(new ClaimAirdropCommand(player.wallet, body.turnstileToken));
  }
}
