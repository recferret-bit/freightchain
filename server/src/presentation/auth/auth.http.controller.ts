import { Controller, Get, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { MeDto } from '../../domain/players/player.dto.js';
import { GetMeQuery } from '../../application/use-cases/auth/get-me/get-me.query.js';
import { LogoutCommand, type LogoutResultDto } from '../../application/use-cases/auth/logout/logout.command.js';
import { RequestChallengeCommand, type ChallengeDto } from '../../application/use-cases/auth/request-challenge/request-challenge.command.js';
import { VerifySignInCommand, type SignInResultDto } from '../../application/use-cases/auth/verify-signin/verify-signin.command.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import { ClearSessionCookieInterceptor, SetSessionCookieInterceptor } from '../../infrastructure/http/interceptors/session-cookie.interceptor.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { challengeBodySchema, verifyBodySchema, type ChallengeBody, type VerifyBody } from './dto/auth.dto.js';

/** Sign-In With Solana: nonce → the wallet signs → verify (sets the httpOnly session cookie). /api/auth/* has its own stricter rate limit (THROTTLE_AUTH_LIMIT). */
@Controller('api')
export class AuthHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('auth/nonce') @HttpCode(200)
  nonce(@ZodBody(challengeBodySchema) body: ChallengeBody): Promise<ChallengeDto> {
    return this.commandBus.execute<RequestChallengeCommand, ChallengeDto>(new RequestChallengeCommand(body.wallet));
  }

  /** The wire body is the rider's profile (MeDto): SetSessionCookieInterceptor moves the session token into the cookie and unwraps `profile`. */
  @Post('auth/verify') @HttpCode(200) @UseInterceptors(SetSessionCookieInterceptor)
  verify(@ZodBody(verifyBodySchema) body: VerifyBody): Promise<SignInResultDto> {
    return this.commandBus.execute<VerifySignInCommand, SignInResultDto>(new VerifySignInCommand(body.wallet, body.signature));
  }

  @Post('auth/logout') @HttpCode(200) @UseInterceptors(ClearSessionCookieInterceptor)
  logout(): Promise<LogoutResultDto> {
    return this.commandBus.execute<LogoutCommand, LogoutResultDto>(new LogoutCommand());
  }

  @Get('me') @UseGuards(PlayerAuthGuard)
  me(@CurrentPlayer() player: PlayerIdentity): Promise<MeDto> {
    return this.queryBus.execute<GetMeQuery, MeDto>(new GetMeQuery(player.wallet));
  }
}
