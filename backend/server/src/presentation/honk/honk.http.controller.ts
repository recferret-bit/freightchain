import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { honkAccountResponse, honkCatalogResponse, honkVisualResponse, honkBurnResponse, honkTimeResponse, honkWeatherResponse } from '../common/response/rest.response.js';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import { TermsGuard } from '../common/guards/terms.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { rideIdParamsSchema, type RideIdParams } from '../common/dto/common.dto.js';
import { z } from 'zod';
import { BurnHonkCommand, GetHonkCatalogQuery, GetHonkQuery, MintHonkVisualCommand, type HonkAccountDto, type HonkBurnResult, type HonkCatalogEntry, type HonkVisualResult } from '../../application/use-cases/honk/honk.handlers.js';
import { BurnHonkTimeCommand, type HonkTimeBurnResult } from '../../application/use-cases/honk/burn-honk-time.handler.js';
import { BurnHonkWeatherCommand, type HonkWeatherBurnResult } from '../../application/use-cases/honk/burn-honk-weather.handler.js';
import { isTransactionSignature, TRANSACTION_SIGNATURE_MESSAGE } from '../../domain/economy/transaction-signature.js';

const honkSignature = z.string().refine(isTransactionSignature, { message: TRANSACTION_SIGNATURE_MESSAGE });
export const honkVisualBodySchema = z.object({ slot: z.string().min(1).max(32), item: z.string().min(1).max(32), signature: honkSignature.optional() }).strict();
type VisualBody = z.infer<typeof honkVisualBodySchema>;
export const honkBurnBodySchema = z.object({ signature: honkSignature.optional() }).strict();
type HonkBurnBody = z.infer<typeof honkBurnBodySchema>;
export const honkTimeBodySchema = z.object({ phase: z.enum(['day', 'night']), signature: honkSignature.optional() }).strict();
type HonkTimeBody = z.infer<typeof honkTimeBodySchema>;
export const honkWeatherBodySchema = z.object({ weather: z.enum(['snow', 'clear']), signature: honkSignature.optional() }).strict();
type HonkWeatherBody = z.infer<typeof honkWeatherBodySchema>;

/** TEN4 balances, the cab-visual catalog, a stream burn, a day/night burn, a weather burn, and a visual mint. The catalog is public. HONK is the chat-line verb. */
@Controller('api')
export class HonkHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('honk') @UseGuards(PlayerAuthGuard, TermsGuard)
  @ZodResponse(honkAccountResponse)
  mine(@CurrentPlayer() player: PlayerIdentity): Promise<HonkAccountDto> {
    return this.queryBus.execute<GetHonkQuery, HonkAccountDto>(new GetHonkQuery(player.wallet));
  }

  @Get('honk/catalog')
  @ZodResponse(honkCatalogResponse)
  catalog(): Promise<HonkCatalogEntry[]> {
    return this.queryBus.execute<GetHonkCatalogQuery, HonkCatalogEntry[]>(new GetHonkCatalogQuery());
  }

  @Post('honk/visuals') @HttpCode(200) @UseGuards(PlayerAuthGuard, TermsGuard)
  @ZodResponse(honkVisualResponse)
  visual(@CurrentPlayer() player: PlayerIdentity, @ZodBody(honkVisualBodySchema) body: VisualBody): Promise<HonkVisualResult> {
    return this.commandBus.execute<MintHonkVisualCommand, HonkVisualResult>(new MintHonkVisualCommand(player.wallet, body.slot, body.item, body.signature));
  }

  /** 200 the burn · 409 not enough TEN4 · 429 one HONK per 10 s, or the chat window is taken (the burn is refunded). `signature` is required only when HONK_PROGRAM_ID is set. */
  @Post('watch/:id/honk') @HttpCode(200) @UseGuards(PlayerAuthGuard, TermsGuard)
  @ZodResponse(honkBurnResponse)
  honk(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodBody(honkBurnBodySchema) body: HonkBurnBody): Promise<HonkBurnResult> {
    return this.commandBus.execute<BurnHonkCommand, HonkBurnResult>(new BurnHonkCommand(player.wallet, params.id, body.signature));
  }

  /** 200 the burn · 409 not enough TEN4 · 429 the effect window is taken (the burn is refunded). Not the HONK chat line. */
  @Post('watch/:id/honk/time') @HttpCode(200) @UseGuards(PlayerAuthGuard, TermsGuard)
  @ZodResponse(honkTimeResponse)
  honkTime(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodBody(honkTimeBodySchema) body: HonkTimeBody): Promise<HonkTimeBurnResult> {
    return this.commandBus.execute<BurnHonkTimeCommand, HonkTimeBurnResult>(new BurnHonkTimeCommand(player.wallet, params.id, body.phase, body.signature));
  }

  /** 200 the burn · 409 not enough TEN4 · 429 the effect window is taken (the burn is refunded). Not a donation. */
  @Post('watch/:id/honk/weather') @HttpCode(200) @UseGuards(PlayerAuthGuard, TermsGuard)
  @ZodResponse(honkWeatherResponse)
  honkWeather(@CurrentPlayer() player: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodBody(honkWeatherBodySchema) body: HonkWeatherBody): Promise<HonkWeatherBurnResult> {
    return this.commandBus.execute<BurnHonkWeatherCommand, HonkWeatherBurnResult>(new BurnHonkWeatherCommand(player.wallet, params.id, body.weather, body.signature));
  }
}
