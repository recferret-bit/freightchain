import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { RedeemPromoCommand, type PromoRedeemedDto } from '../../application/use-cases/players/redeem-promo/redeem-promo.command.js';
import { GetPrizePoolQuery, type PrizePoolDetailDto } from '../../application/use-cases/pools/get-prize-pool/get-prize-pool.query.js';
import { ListPoolsQuery, type PoolListDto } from '../../application/use-cases/pools/list-pools/list-pools.query.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { poolIdParamsSchema, redeemPromoBodySchema, type PoolIdParams, type RedeemPromoBody } from './dto/pools.dto.js';

/** The escrowed prize pools (public: anyone can check a pool's rules and progress) and promo codes (signed-in: free tickets into a pool). */
@Controller('api')
export class PoolsHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('pools')
  list(): Promise<PoolListDto> {
    return this.queryBus.execute<ListPoolsQuery, PoolListDto>(new ListPoolsQuery());
  }

  @Get('pools/:id')
  get(@ZodParams(poolIdParamsSchema) params: PoolIdParams): Promise<PrizePoolDetailDto> {
    return this.queryBus.execute<GetPrizePoolQuery, PrizePoolDetailDto>(new GetPrizePoolQuery(params.id));
  }

  /** 200 `{ poolId, added, balance, cap }` · 404 unknown code · 409 used up / expired / already redeemed / at the pool's cap / no open pool. */
  @Post('promo/redeem') @HttpCode(200) @UseGuards(PlayerAuthGuard)
  redeem(@CurrentPlayer() player: PlayerIdentity, @ZodBody(redeemPromoBodySchema) body: RedeemPromoBody): Promise<PromoRedeemedDto> {
    return this.commandBus.execute<RedeemPromoCommand, PromoRedeemedDto>(new RedeemPromoCommand(player.wallet, body.code));
  }
}
