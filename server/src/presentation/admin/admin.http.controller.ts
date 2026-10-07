import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { AdminActionDto, AdminListDto, AdminLogsDto, AdminOverviewDto, AdminRideDetailDto, AdminRideRowDto, SignInRowDto } from '../../domain/admin/admin.dto.js';
import type { VerdictDto } from '../../domain/verdict/verdict.dto.js';
import { GetAdminLogsQuery } from '../../application/use-cases/admin/get-admin-logs/get-admin-logs.query.js';
import { GetAdminOverviewQuery } from '../../application/use-cases/admin/get-admin-overview/get-admin-overview.query.js';
import { GetAdminRideQuery } from '../../application/use-cases/admin/get-admin-ride/get-admin-ride.query.js';
import { ListAdminActionsQuery } from '../../application/use-cases/admin/list-admin-actions/list-admin-actions.query.js';
import { ListAdminRidesQuery } from '../../application/use-cases/admin/list-admin-rides/list-admin-rides.query.js';
import { ListSignInsQuery } from '../../application/use-cases/admin/list-sign-ins/list-sign-ins.query.js';
import { OverrideVerdictCommand } from '../../application/use-cases/admin/override-verdict/override-verdict.command.js';
import { RejudgeRideCommand } from '../../application/use-cases/admin/rejudge-ride/rejudge-ride.command.js';
import { CurrentRequestId } from '../../infrastructure/http/decorators/client-info.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams, ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import { AdminGuard } from '../../infrastructure/http/guards/admin.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { rideIdParamsSchema, type RideIdParams } from '../common/dto/common.dto.js';
import {
  actionsQuerySchema, adminRidesQuerySchema, logsQuerySchema, overrideBodySchema, signInsQuerySchema,
  type ActionsQuery, type AdminRidesQuery, type LogsQuery, type OverrideBody, type SignInsQuery,
} from './dto/admin.dto.js';

/** The admin page's API (/admin.html). Only wallets in ADMIN_WALLETS – to anybody else every route is a 404. Changes need the X-FC-Admin header and are audited. */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('overview')
  overview(): Promise<AdminOverviewDto> {
    return this.queryBus.execute<GetAdminOverviewQuery, AdminOverviewDto>(new GetAdminOverviewQuery());
  }

  /** ?verdict=flagged is the review queue */
  @Get('rides')
  rides(@ZodQuery(adminRidesQuerySchema) query: AdminRidesQuery): Promise<AdminListDto<AdminRideRowDto>> {
    return this.queryBus.execute<ListAdminRidesQuery, AdminListDto<AdminRideRowDto>>(new ListAdminRidesQuery(query));
  }

  @Get('rides/:id')
  ride(@ZodParams(rideIdParamsSchema) params: RideIdParams): Promise<AdminRideDetailDto> {
    return this.queryBus.execute<GetAdminRideQuery, AdminRideDetailDto>(new GetAdminRideQuery(params.id));
  }

  /** Accept (verified) or reject a ride's verdict by hand. */
  @Post('rides/:id/verdict') @HttpCode(200)
  override(
    @CurrentPlayer() admin: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams, @ZodBody(overrideBodySchema) body: OverrideBody, @CurrentRequestId() requestId: string,
  ): Promise<VerdictDto> {
    return this.commandBus.execute<OverrideVerdictCommand, VerdictDto>(new OverrideVerdictCommand(admin.wallet, params.id, body.decision, body.note, requestId));
  }

  /** Judge the ride again at the current rules (replaces a decision). */
  @Post('rides/:id/rejudge') @HttpCode(200)
  rejudge(@CurrentPlayer() admin: PlayerIdentity, @ZodParams(rideIdParamsSchema) params: RideIdParams, @CurrentRequestId() requestId: string): Promise<VerdictDto> {
    return this.commandBus.execute<RejudgeRideCommand, VerdictDto>(new RejudgeRideCommand(admin.wallet, params.id, requestId));
  }

  @Get('signins')
  signIns(@ZodQuery(signInsQuerySchema) query: SignInsQuery): Promise<AdminListDto<SignInRowDto>> {
    return this.queryBus.execute<ListSignInsQuery, AdminListDto<SignInRowDto>>(new ListSignInsQuery(query.limit, query.wallet));
  }

  @Get('actions')
  actions(@ZodQuery(actionsQuerySchema) query: ActionsQuery): Promise<AdminListDto<AdminActionDto>> {
    return this.queryBus.execute<ListAdminActionsQuery, AdminListDto<AdminActionDto>>(new ListAdminActionsQuery(query.limit));
  }

  /** This process's newest log lines (?level=warn, ?q=<request id / wallet / ride id>). */
  @Get('logs')
  logs(@ZodQuery(logsQuerySchema) query: LogsQuery): Promise<AdminLogsDto> {
    return this.queryBus.execute<GetAdminLogsQuery, AdminLogsDto>(new GetAdminLogsQuery(query));
  }
}
