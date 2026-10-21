import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { promoListResponse, promoRedemptionListResponse, promoResponse } from '../common/response/economy.response.js';
import { adminChallengeResponse } from '../common/response/admin.response.js';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { PromoDto } from '../../domain/economy/promo.dto.js';
import type { ChallengeDto } from '../../application/use-cases/auth/request-challenge/request-challenge.command.js';
import { CreateAdminPromoCommand } from '../../application/use-cases/admin/create-admin-promo/create-admin-promo.command.js';
import { DisableAdminPromoCommand } from '../../application/use-cases/admin/disable-admin-promo/disable-admin-promo.command.js';
import { ListPromoRedemptionsQuery, type PromoRedemptionListDto } from '../../application/use-cases/admin/list-promo-redemptions/list-promo-redemptions.query.js';
import { RequestActionChallengeCommand } from '../../application/use-cases/admin/request-action-challenge/request-action-challenge.command.js';
import { ListPromosQuery, type PromoListDto } from '../../application/use-cases/promos/list-promos/list-promos.query.js';
import { CurrentRequestId } from '../../infrastructure/http/decorators/client-info.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams, ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { AdminGuard } from '../../infrastructure/http/guards/admin.guard.js';
import { Roles } from '../../infrastructure/http/guards/privileged.decorator.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import {
  createPromoBodySchema, disablePromoBodySchema, promoChallengeBodySchema, promoCodeParamsSchema, promoRedemptionsQuerySchema, promosQuerySchema,
  type CreatePromoBody, type DisablePromoBody, type PromoChallengeBody, type PromoCodeParams, type PromoRedemptionsQuery, type PromosQuery,
} from './dto/admin-promos.dto.js';

/** The admin page's PROMOCODES tab (same guard as the rest of /api/admin: admin host, admin session, X-FC-Admin on changes). Creating and disabling are signed by the admin's wallet and audited. */
@Controller('api/admin/promos')
@UseGuards(AdminGuard)
@Roles('admin')
export class AdminPromosHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /** `?state=active|scheduled|ended|exhausted|disabled` – no state = every code. */
  @Get()
  @ZodResponse(promoListResponse)
  list(@ZodQuery(promosQuerySchema) query: PromosQuery): Promise<PromoListDto> {
    return this.queryBus.execute<ListPromosQuery, PromoListDto>(new ListPromosQuery(query.state));
  }

  /** Who used which code, newest first (`?code=`, `?wallet=`, `?limit=`). */
  @Get('redemptions')
  @ZodResponse(promoRedemptionListResponse)
  redemptions(@ZodQuery(promoRedemptionsQuerySchema) query: PromoRedemptionsQuery): Promise<PromoRedemptionListDto> {
    return this.queryBus.execute<ListPromoRedemptionsQuery, PromoRedemptionListDto>(new ListPromoRedemptionsQuery(query.limit, query.code ?? null, query.wallet ?? null));
  }

  /** The text the admin's wallet signs before ONE promo change: a new code with every field, or the disabling of one. */
  @Post('challenge') @HttpCode(200)
  @ZodResponse(adminChallengeResponse)
  challenge(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(promoChallengeBodySchema) body: PromoChallengeBody): Promise<ChallengeDto> {
    const intent = body.action === 'promo_create' ? { action: 'promo_create' as const, promo: body.promo } : { action: 'promo_disable' as const, code: body.code };
    return this.commandBus.execute<RequestActionChallengeCommand, ChallengeDto>(new RequestActionChallengeCommand(admin.wallet, intent));
  }

  /** 200 the new code · 400 a field is wrong · 401 the signature does not cover exactly this code · 409 the code exists. */
  @Post() @HttpCode(200)
  @ZodResponse(promoResponse)
  create(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(createPromoBodySchema) body: CreatePromoBody, @CurrentRequestId() requestId: string): Promise<PromoDto> {
    return this.commandBus.execute<CreateAdminPromoCommand, PromoDto>(new CreateAdminPromoCommand(admin.wallet, body.promo, requestId, body.signature));
  }

  @Post(':code/disable') @HttpCode(200)
  @ZodResponse(promoResponse)
  disable(@CurrentPlayer() admin: PlayerIdentity, @ZodParams(promoCodeParamsSchema) params: PromoCodeParams, @ZodBody(disablePromoBodySchema) body: DisablePromoBody, @CurrentRequestId() requestId: string): Promise<PromoDto> {
    return this.commandBus.execute<DisableAdminPromoCommand, PromoDto>(new DisableAdminPromoCommand(admin.wallet, params.code, requestId, body.signature));
  }
}
