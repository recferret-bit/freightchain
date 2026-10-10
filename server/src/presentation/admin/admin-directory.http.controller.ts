import { Controller, Get, UseGuards } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import type { AdminListDto, AdminPlayerDetailDto, AdminPlayerRowDto, AdminPoolDetailDto, AdminPoolRowDto, AdminSessionsDto, AdminStatsDto } from '../../domain/admin/admin.dto.js';
import { GetAdminPlayerQuery } from '../../application/use-cases/admin/get-admin-player/get-admin-player.query.js';
import { GetAdminPoolQuery } from '../../application/use-cases/admin/get-admin-pool/get-admin-pool.query.js';
import { GetAdminQueueCountQuery } from '../../application/use-cases/admin/get-admin-queue-count/get-admin-queue-count.query.js';
import { GetAdminStatsQuery } from '../../application/use-cases/admin/get-admin-stats/get-admin-stats.query.js';
import { ListAdminPlayersQuery } from '../../application/use-cases/admin/list-admin-players/list-admin-players.query.js';
import { ListAdminPoolsQuery } from '../../application/use-cases/admin/list-admin-pools/list-admin-pools.query.js';
import { ListAdminSessionsQuery } from '../../application/use-cases/admin/list-admin-sessions/list-admin-sessions.query.js';
import { ZodParams, ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import { AdminGuard } from '../../infrastructure/http/guards/admin.guard.js';
import {
  adminStatsQuerySchema, playersQuerySchema, poolIdParamsSchema, poolsQuerySchema, sessionsQuerySchema, walletParamsSchema,
  type AdminStatsQuery, type PlayersQuery, type PoolIdParams, type PoolsQuery, type SessionsQuery, type WalletParams,
} from './dto/admin-directory.dto.js';

/** The admin page's read-only directory: players, pools, statistics, sessions. Same guard as the rest of /api/admin; nothing here changes anything. */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminDirectoryHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  /** the REVIEW QUEUE badge: a count, not the list (asked on every tab change) */
  @Get('queue/count')
  queueCount(): Promise<{ flagged: number }> {
    return this.queryBus.execute<GetAdminQueueCountQuery, { flagged: number }>(new GetAdminQueueCountQuery());
  }

  @Get('players')
  players(@ZodQuery(playersQuerySchema) query: PlayersQuery): Promise<AdminListDto<AdminPlayerRowDto>> {
    return this.queryBus.execute<ListAdminPlayersQuery, AdminListDto<AdminPlayerRowDto>>(new ListAdminPlayersQuery(query.limit, query.q));
  }

  @Get('players/:wallet')
  player(@ZodParams(walletParamsSchema) params: WalletParams): Promise<AdminPlayerDetailDto> {
    return this.queryBus.execute<GetAdminPlayerQuery, AdminPlayerDetailDto>(new GetAdminPlayerQuery(params.wallet));
  }

  @Get('pools')
  pools(@ZodQuery(poolsQuerySchema) query: PoolsQuery): Promise<AdminListDto<AdminPoolRowDto>> {
    return this.queryBus.execute<ListAdminPoolsQuery, AdminListDto<AdminPoolRowDto>>(new ListAdminPoolsQuery(query.limit));
  }

  @Get('pools/:id')
  pool(@ZodParams(poolIdParamsSchema) params: PoolIdParams): Promise<AdminPoolDetailDto> {
    return this.queryBus.execute<GetAdminPoolQuery, AdminPoolDetailDto>(new GetAdminPoolQuery(params.id));
  }

  @Get('stats')
  stats(@ZodQuery(adminStatsQuerySchema) query: AdminStatsQuery): Promise<AdminStatsDto> {
    return this.queryBus.execute<GetAdminStatsQuery, AdminStatsDto>(new GetAdminStatsQuery(query.days, query.top));
  }

  @Get('sessions')
  sessions(@ZodQuery(sessionsQuerySchema) query: SessionsQuery): Promise<AdminSessionsDto> {
    return this.queryBus.execute<ListAdminSessionsQuery, AdminSessionsDto>(new ListAdminSessionsQuery(query.days));
  }
}
