import { Module, type Provider } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { InfrastructureModule } from '../infrastructure/infrastructure.module.js';
import { AchievementService } from './services/achievement.service.js';
import { PaymentSettlementService } from './services/payment-settlement.service.js';
import { PlayerSessionService } from './services/player-session.service.js';
import { RideLookupService } from './services/ride-lookup.service.js';
import { RoundService } from './services/round.service.js';
import { VerdictService } from './services/verdict.service.js';
import { GrantDailyFreeRidesHandler } from './use-cases/players/grant-daily-free-rides/grant-daily-free-rides.handler.js';
import { GetMeHandler } from './use-cases/auth/get-me/get-me.handler.js';
import { LogoutHandler } from './use-cases/auth/logout/logout.handler.js';
import { RequestChallengeHandler } from './use-cases/auth/request-challenge/request-challenge.handler.js';
import { VerifySignInHandler } from './use-cases/auth/verify-signin/verify-signin.handler.js';
import { GetLeaderboardHandler } from './use-cases/economy/get-leaderboard/get-leaderboard.handler.js';
import { GetPoolHandler } from './use-cases/economy/get-pool/get-pool.handler.js';
import { GetTiersHandler } from './use-cases/economy/get-tiers/get-tiers.handler.js';
import { GetLivenessHandler } from './use-cases/health/get-liveness/get-liveness.handler.js';
import { GetReadinessHandler } from './use-cases/health/get-readiness/get-readiness.handler.js';
import { GetLiveHandler } from './use-cases/lobby/get-live/get-live.handler.js';
import { GetProfileHandler } from './use-cases/lobby/get-profile/get-profile.handler.js';
import { ConfirmPaymentHandler } from './use-cases/rides/confirm-payment/confirm-payment.handler.js';
import { CreateRideHandler } from './use-cases/rides/create-ride/create-ride.handler.js';
import { EndRideHandler } from './use-cases/rides/end-ride/end-ride.handler.js';
import { GetPaymentInstructionsHandler } from './use-cases/rides/get-payment-instructions/get-payment-instructions.handler.js';
import { GetPendingRideHandler } from './use-cases/rides/get-pending-ride/get-pending-ride.handler.js';
import { GetRideHandler } from './use-cases/rides/get-ride/get-ride.handler.js';
import { HeartbeatRideHandler } from './use-cases/rides/heartbeat-ride/heartbeat-ride.handler.js';
import { ReconcilePaymentHandler } from './use-cases/rides/reconcile-payment/reconcile-payment.handler.js';
import { StartRideHandler } from './use-cases/rides/start-ride/start-ride.handler.js';
import { UploadBatchHandler } from './use-cases/telemetry/upload-batch/upload-batch.handler.js';
import { SweepTelemetryHandler } from './use-cases/telemetry/sweep-telemetry/sweep-telemetry.handler.js';
import { GetAdminLogsHandler } from './use-cases/admin/get-admin-logs/get-admin-logs.handler.js';
import { GetAdminOverviewHandler } from './use-cases/admin/get-admin-overview/get-admin-overview.handler.js';
import { GetAdminRideHandler } from './use-cases/admin/get-admin-ride/get-admin-ride.handler.js';
import { ListAdminActionsHandler } from './use-cases/admin/list-admin-actions/list-admin-actions.handler.js';
import { ListAdminRidesHandler } from './use-cases/admin/list-admin-rides/list-admin-rides.handler.js';
import { ListSignInsHandler } from './use-cases/admin/list-sign-ins/list-sign-ins.handler.js';
import { OverrideVerdictHandler } from './use-cases/admin/override-verdict/override-verdict.handler.js';
import { RejudgeRideHandler } from './use-cases/admin/rejudge-ride/rejudge-ride.handler.js';
import { RequestAdminChallengeHandler } from './use-cases/admin/request-admin-challenge/request-admin-challenge.handler.js';
import { VerifyAdminSignInHandler } from './use-cases/admin/verify-admin-signin/verify-admin-signin.handler.js';

const services: Provider[] = [AchievementService, PaymentSettlementService, PlayerSessionService, RideLookupService, RoundService, VerdictService];

const handlers: Provider[] = [
  RequestChallengeHandler, VerifySignInHandler, GetMeHandler, LogoutHandler,
  CreateRideHandler, GetRideHandler, GetPendingRideHandler, StartRideHandler, HeartbeatRideHandler, EndRideHandler,
  GetPaymentInstructionsHandler, ConfirmPaymentHandler, ReconcilePaymentHandler,
  UploadBatchHandler, SweepTelemetryHandler,
  GetAdminOverviewHandler, ListAdminRidesHandler, GetAdminRideHandler, ListSignInsHandler, ListAdminActionsHandler, GetAdminLogsHandler, OverrideVerdictHandler, RejudgeRideHandler, RequestAdminChallengeHandler, VerifyAdminSignInHandler,
  GetTiersHandler, GetPoolHandler, GetLeaderboardHandler,
  GetLiveHandler, GetProfileHandler,
  GetLivenessHandler, GetReadinessHandler,
  GrantDailyFreeRidesHandler,
];

@Module({
  imports: [CqrsModule.forRoot(), InfrastructureModule],
  providers: [...services, ...handlers],
  exports: [CqrsModule, InfrastructureModule],
})
export class ApplicationModule {}
