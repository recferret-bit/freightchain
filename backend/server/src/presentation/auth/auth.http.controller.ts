import { Controller, Get, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { authChallengeResponse, openPairResponse, pollPairResponse, okResponse, meResponse } from '../common/response/wire.js';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { MeDto } from '../../domain/players/player.dto.js';
import { GetMeQuery } from '../../application/use-cases/auth/get-me/get-me.query.js';
import { LogoutCommand, type LogoutResultDto } from '../../application/use-cases/auth/logout/logout.command.js';
import { ClaimPhonePairCommand, OpenPhonePairCommand, PollPhonePairCommand, type OpenPhonePairDto, type PollPhonePairDto } from '../../application/use-cases/auth/phone-pair/phone-pair.command.js';
import { RequestChallengeCommand, type ChallengeDto } from '../../application/use-cases/auth/request-challenge/request-challenge.command.js';
import { VerifySignInCommand, type SignInResultDto } from '../../application/use-cases/auth/verify-signin/verify-signin.command.js';
import type { GeoHeaders } from '../../application/ports/prize/geo-locator.port.js';
import { StartGuestCommand } from '../../application/use-cases/auth/start-guest/start-guest.command.js';
import { ClientGeo } from '../../infrastructure/http/decorators/client-geo.js';
import { CurrentClient, CurrentOrigin, CurrentPairSecret, CurrentSessionToken } from '../../infrastructure/http/decorators/client-info.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import type { ClientInfo } from '../../domain/auth/sign-in.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import { AdoptPairSessionInterceptor, SetPairCookieInterceptor } from '../../infrastructure/http/interceptors/phone-pair.interceptor.js';
import { ClearSessionCookieInterceptor, SetSessionCookieInterceptor } from '../../infrastructure/http/interceptors/session-cookie.interceptor.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { pairParamsSchema, requestChallengeBodySchema, verifyBodySchema, type PairParams, type RequestChallengeBody, type VerifyBody } from './dto/auth.dto.js';

/** Sign-In With Solana: nonce → the wallet signs → verify (sets the httpOnly session cookie). /api/auth/* has its own stricter rate limit (THROTTLE_AUTH_LIMIT). */
@Controller('api')
export class AuthHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('auth/nonce') @HttpCode(200)
  @ZodResponse(authChallengeResponse)
  nonce(@ZodBody(requestChallengeBodySchema) body: RequestChallengeBody, @CurrentOrigin() origin: string | null): Promise<ChallengeDto> {
    return this.commandBus.execute<RequestChallengeCommand, ChallengeDto>(new RequestChallengeCommand(body.wallet, origin));
  }

  /** Desktop: a code for the QR, and an httpOnly secret cookie that is not in the picture. */
  @Post('auth/pair') @HttpCode(200) @UseInterceptors(SetPairCookieInterceptor)
  @ZodResponse(openPairResponse)
  openPair(): Promise<OpenPhonePairDto> {
    return this.commandBus.execute<OpenPhonePairCommand, OpenPhonePairDto>(new OpenPhonePairCommand());
  }

  /** Desktop: pending, or the phone's session moved onto this browser. */
  @Get('auth/pair/:id') @UseInterceptors(AdoptPairSessionInterceptor)
  @ZodResponse(pollPairResponse)
  pollPair(@ZodParams(pairParamsSchema) params: PairParams, @CurrentPairSecret() secret: string | null): Promise<PollPhonePairDto> {
    return this.commandBus.execute<PollPhonePairCommand, PollPhonePairDto>(new PollPhonePairCommand(params.id, secret));
  }

  /** Phone: the session just created here is the one the computer adopts. */
  @Post('auth/pair/:id/claim') @HttpCode(200) @UseGuards(PlayerAuthGuard)
  @ZodResponse(okResponse)
  claimPair(@ZodParams(pairParamsSchema) params: PairParams, @CurrentSessionToken() token: string | null): Promise<{ ok: true }> {
    return this.commandBus.execute<ClaimPhonePairCommand, { ok: true }>(new ClaimPhonePairCommand(params.id, token));
  }

  /** The wire body is the rider's profile (MeDto): SetSessionCookieInterceptor moves the session token into the cookie and unwraps `profile`. */
  @Post('auth/verify') @HttpCode(200) @UseInterceptors(SetSessionCookieInterceptor)
  @ZodResponse(meResponse)
  verify(@ZodBody(verifyBodySchema) body: VerifyBody, @CurrentClient() client: ClientInfo): Promise<SignInResultDto> {
    return this.commandBus.execute<VerifySignInCommand, SignInResultDto>(new VerifySignInCommand(body.wallet, body.signature, client, body.message, body.nonce));
  }

  @Post('auth/logout') @HttpCode(200) @UseInterceptors(ClearSessionCookieInterceptor)
  @ZodResponse(okResponse)
  logout(): Promise<LogoutResultDto> {
    return this.commandBus.execute<LogoutCommand, LogoutResultDto>(new LogoutCommand());
  }

  /** Anonymous EASY. A throwaway wallet, no secret stored. The cookie is the same session as a signed-in rider. */
  @Post('auth/guest') @HttpCode(200) @UseInterceptors(SetSessionCookieInterceptor)
  @ZodResponse(meResponse)
  guest(@CurrentClient() client: ClientInfo): Promise<SignInResultDto> {
    return this.commandBus.execute<StartGuestCommand, SignInResultDto>(new StartGuestCommand(client));
  }

  @Get('me') @UseGuards(PlayerAuthGuard)
  @ZodResponse(meResponse)
  me(@CurrentPlayer() player: PlayerIdentity, @ClientGeo() headers: GeoHeaders = {}): Promise<MeDto> {
    return this.queryBus.execute<GetMeQuery, MeDto>(new GetMeQuery(player.wallet, headers));
  }
}

