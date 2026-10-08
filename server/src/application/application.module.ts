import { Module, type Provider } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { InfrastructureModule } from '../infrastructure/infrastructure.module.js';
import { AchievementService } from './services/achievement.service.js';
import { PaymentSettlementService } from './services/payment-settlement.service.js';
import { PlayerSessionService } from './services/player-session.service.js';
import { RideLookupService } from './services/ride-lookup.service.js';
import { RoundService } from './services/round.service.js';
import { VerdictService } from './services/verdict.service.js';
import { AdminProofService } from './services/admin-proof.service.js';
import { GrantDailyFreeRidesHandler } from './use-cases/players/grant-daily-free-rides/grant-daily-free-rides.handler.js';
import { GetMeHandler } from './use-cases/auth/get-me/get-me.handler.js';
import { LogoutHandler } from './use-cases/auth/logout/logout.handler.js';
import { RequestChallengeHandler } from './use-cases/auth/request-challenge/request-challenge.handler.js';
import { VerifySignInHandler } from './use-cases/auth/verify-signin/verify-signin.handler.js';
import { GetChainFeesHandler } from './use-cases/chain/get-chain-fees/get-chain-fees.handler.js';
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
import { RequestActionChallengeHandler } from './use-cases/admin/request-action-challenge/request-action-challenge.handler.js';

import { PoolTicketsService } from './services/pool-tickets.service.js';
import { TicketSettlementService } from './services/ticket-settlement.service.js';
import { PoolRegistryService } from './services/pool-registry.service.js';
import { GetTicketPaymentHandler } from './use-cases/tickets/get-ticket-payment/get-ticket-payment.handler.js';
import { ConfirmTicketOrderHandler } from './use-cases/tickets/confirm-ticket-order/confirm-ticket-order.handler.js';
import { SubmitTicketOrderHandler } from './use-cases/tickets/submit-ticket-order/submit-ticket-order.handler.js';
import { GetRefundTransactionHandler } from './use-cases/pools/get-refund-transaction/get-refund-transaction.handler.js';
import { GetPayoutTransactionsHandler } from './use-cases/pools/get-payout-transactions/get-payout-transactions.handler.js';
import { SettleChainSignatureHandler } from './use-cases/chain/settle-chain-signature/settle-chain-signature.handler.js';
import { ListPoolsHandler } from './use-cases/pools/list-pools/list-pools.handler.js';
import { GetPrizePoolHandler } from './use-cases/pools/get-prize-pool/get-prize-pool.handler.js';
import { RedeemPromoHandler } from './use-cases/players/redeem-promo/redeem-promo.handler.js';

import { CreateTicketOrderHandler } from './use-cases/tickets/create-ticket-order/create-ticket-order.handler.js';
import { GetTicketOrderHandler } from './use-cases/tickets/get-ticket-order/get-ticket-order.handler.js';
import { GetPendingTicketOrderHandler } from './use-cases/tickets/get-pending-ticket-order/get-pending-ticket-order.handler.js';
import { RegisterPoolHandler } from './use-cases/pools/register-pool/register-pool.handler.js';
import { CreatePromoHandler } from './use-cases/promos/create-promo/create-promo.handler.js';
import { ListPromosHandler } from './use-cases/promos/list-promos/list-promos.handler.js';
import { DisablePromoHandler } from './use-cases/promos/disable-promo/disable-promo.handler.js';
import { GrantTicketsHandler } from './use-cases/players/grant-tickets/grant-tickets.handler.js';
import { FinalityService } from './services/finality.service.js';
import { PollProgramHandler } from './use-cases/chain/poll-program/poll-program.handler.js';
import { SyncPoolsHandler } from './use-cases/chain/sync-pools/sync-pools.handler.js';
import { ReceiveChainWebhookHandler } from './use-cases/chain/receive-chain-webhook/receive-chain-webhook.handler.js';
import { RegisterPoolFromChainHandler } from './use-cases/pools/register-pool-from-chain/register-pool-from-chain.handler.js';

const services: Provider[] = [
  AchievementService, PaymentSettlementService, PlayerSessionService, RideLookupService, RoundService, VerdictService, AdminProofService,
  PoolTicketsService, TicketSettlementService, PoolRegistryService, FinalityService,
];

const handlers: Provider[] = [
  RequestChallengeHandler, VerifySignInHandler, GetMeHandler, LogoutHandler,
  CreateRideHandler, GetRideHandler, GetPendingRideHandler, StartRideHandler, HeartbeatRideHandler, EndRideHandler,
  GetPaymentInstructionsHandler, ConfirmPaymentHandler, ReconcilePaymentHandler,
  UploadBatchHandler, SweepTelemetryHandler,
  GetAdminOverviewHandler, ListAdminRidesHandler, GetAdminRideHandler, ListSignInsHandler, ListAdminActionsHandler, GetAdminLogsHandler, OverrideVerdictHandler, RejudgeRideHandler, RequestAdminChallengeHandler, VerifyAdminSignInHandler, RequestActionChallengeHandler,
  GetTiersHandler, GetPoolHandler, GetLeaderboardHandler,
  GetLiveHandler, GetProfileHandler,
  GetLivenessHandler, GetReadinessHandler,
  GrantDailyFreeRidesHandler,
  ListPoolsHandler, GetPrizePoolHandler, RedeemPromoHandler,
  CreatePromoHandler, ListPromosHandler, DisablePromoHandler, GrantTicketsHandler, RegisterPoolHandler,
  CreateTicketOrderHandler, GetTicketOrderHandler, GetPendingTicketOrderHandler,
  SettleChainSignatureHandler, GetTicketPaymentHandler, ConfirmTicketOrderHandler, SubmitTicketOrderHandler,
  GetRefundTransactionHandler, GetPayoutTransactionsHandler,
  GetChainFeesHandler,
  PollProgramHandler, SyncPoolsHandler, ReceiveChainWebhookHandler, RegisterPoolFromChainHandler,
];

@Module({
  imports: [CqrsModule.forRoot(), InfrastructureModule],
  providers: [...services, ...handlers],
  exports: [CqrsModule, InfrastructureModule],
})
export class ApplicationModule {}
