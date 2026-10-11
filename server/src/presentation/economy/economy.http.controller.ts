import { Controller, Get, UseGuards } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import type { LeaderboardDto, PoolDto, TiersDto } from '../../domain/economy/economy.dto.js';
import { GetLeaderboardQuery } from '../../application/use-cases/economy/get-leaderboard/get-leaderboard.query.js';
import { GetPoolQuery } from '../../application/use-cases/economy/get-pool/get-pool.query.js';
import { GetTiersQuery } from '../../application/use-cases/economy/get-tiers/get-tiers.query.js';
import { OptionalSession } from '../../infrastructure/http/decorators/optional-session.js';
import { ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import { OptionalSessionGuard } from '../../infrastructure/http/guards/optional-session.guard.js';
import { leaderboardQuerySchema, type LeaderboardQuery } from './dto/economy.dto.js';

/** Public: what the landing page and the lobby show before / without a wallet. */
@Controller('api')
export class EconomyHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('tiers')
  tiers(): Promise<TiersDto> {
    return this.queryBus.execute<GetTiersQuery, TiersDto>(new GetTiersQuery());
  }

  /** The weekly prize pool. Lamports are the truth; usd is "≈ at the current price". */
  @Get('pool')
  pool(): Promise<PoolDto> {
    return this.queryBus.execute<GetPoolQuery, PoolDto>(new GetPoolQuery());
  }

  /** Public. `me=1` adds the signed-in rider's place (the cookie is optional — a missing one leaves `standing` null). */
  @Get('leaderboard') @UseGuards(OptionalSessionGuard)
  leaderboard(@ZodQuery(leaderboardQuerySchema) query: LeaderboardQuery, @OptionalSession() wallet: string | null): Promise<LeaderboardDto> {
    return this.queryBus.execute<GetLeaderboardQuery, LeaderboardDto>(new GetLeaderboardQuery(query.board, query.level, query.sort, query.page, query.me ? wallet : null, query.tier));
  }
}
