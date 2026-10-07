import { Controller, Get, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import type { ClientInfo } from '../../domain/auth/sign-in.js';
import { LogoutCommand, type LogoutResultDto } from '../../application/use-cases/auth/logout/logout.command.js';
import type { ChallengeDto } from '../../application/use-cases/auth/request-challenge/request-challenge.command.js';
import { RequestAdminChallengeCommand } from '../../application/use-cases/admin/request-admin-challenge/request-admin-challenge.command.js';
import { VerifyAdminSignInCommand, type AdminSignInResultDto } from '../../application/use-cases/admin/verify-admin-signin/verify-admin-signin.command.js';
import { CurrentClient } from '../../infrastructure/http/decorators/client-info.js';
import { AdminPublic } from '../../infrastructure/http/guards/admin.guard.js';
import { ClearAdminCookieInterceptor, SetAdminCookieInterceptor } from '../../infrastructure/http/interceptors/admin-cookie.interceptor.js';
import { challengeBodySchema, verifyBodySchema, type ChallengeBody, type VerifyBody } from '../auth/dto/auth.dto.js';
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

/** The admin page's API (admin.<apex>). An admin session (the admin sign-in below) of a wallet in ADMIN_WALLETS – to anybody else every route is a 404. Changes need the X-FC-Admin header and are audited. */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /** Admin sign-in, step 1: the message for the wallet to sign (404 unless the wallet is in ADMIN_WALLETS). */
  @Post('auth/nonce') @HttpCode(200) @AdminPublic()
  nonce(@ZodBody(challengeBodySchema) body: ChallengeBody): Promise<ChallengeDto> {
    return this.commandBus.execute<RequestAdminChallengeCommand, ChallengeDto>(new RequestAdminChallengeCommand(body.wallet));
  }

  /** Step 2: the signature → the fc_admin cookie (SetAdminCookieInterceptor); the body says whose session it is and until when. */
  @Post('auth/verify') @HttpCode(200) @AdminPublic() @UseInterceptors(SetAdminCookieInterceptor)
  verify(@ZodBody(verifyBodySchema) body: VerifyBody, @CurrentClient() client: ClientInfo, @CurrentRequestId() requestId: string): Promise<AdminSignInResultDto> {
    return this.commandBus.execute<VerifyAdminSignInCommand, AdminSignInResultDto>(new VerifyAdminSignInCommand(body.wallet, body.signature, client, requestId));
  }

  /** Ends the admin session (works with an expired one too); the player session is left alone. */
  @Post('auth/logout') @HttpCode(200) @AdminPublic() @UseInterceptors(ClearAdminCookieInterceptor)
  logout(): Promise<LogoutResultDto> {
    return this.commandBus.execute<LogoutCommand, LogoutResultDto>(new LogoutCommand());
  }

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
