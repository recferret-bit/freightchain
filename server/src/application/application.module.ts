import { Module, type Provider } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { InfrastructureModule } from '../infrastructure/infrastructure.module.js';
import { AchievementService } from './services/achievement.service.js';
import { PaymentSettlementService } from './services/payment-settlement.service.js';
import { PlayerSessionService } from './services/player-session.service.js';
import { RideLookupService } from './services/ride-lookup.service.js';
import { RoundService } from './services/round.service.js';
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

const services: Provider[] = [AchievementService, PaymentSettlementService, PlayerSessionService, RideLookupService, RoundService];

const handlers: Provider[] = [
  RequestChallengeHandler, VerifySignInHandler, GetMeHandler, LogoutHandler,
  CreateRideHandler, GetRideHandler, GetPendingRideHandler, StartRideHandler, HeartbeatRideHandler, EndRideHandler,
  GetPaymentInstructionsHandler, ConfirmPaymentHandler, ReconcilePaymentHandler,
  UploadBatchHandler,
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
