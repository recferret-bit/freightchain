import { Module, type Provider } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { InfrastructureModule } from '../infrastructure/infrastructure.module.js';
import { AchievementService } from './services/achievement.service.js';
import { PaymentSettlementService } from './services/payment-settlement.service.js';
import { PlayerSessionService } from './services/player-session.service.js';
import { MeProfileService } from './services/me-profile.service.js';
import { RideLookupService } from './services/ride-lookup.service.js';
import { StatsService } from './services/stats.service.js';
import { RoundService } from './services/round.service.js';
import { VerdictService } from './services/verdict.service.js';
import { PoolAttentionService } from './services/pool-attention.service.js';
import { AttestationService } from './services/attestation.service.js';
import { AdminProofService } from './services/admin-proof.service.js';
import { GameSettingsService } from './services/game-settings.service.js';
import { GrantDailyFreeRidesHandler } from './use-cases/players/grant-daily-free-rides/grant-daily-free-rides.handler.js';
import { RecordTelemetryHandler } from './use-cases/telemetry/record-telemetry/record-telemetry.handler.js';
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
import { GetPublicRideHandler } from './use-cases/rides/get-public-ride/get-public-ride.handler.js';
import { HeartbeatRideHandler } from './use-cases/rides/heartbeat-ride/heartbeat-ride.handler.js';
import { ReconcilePaymentHandler } from './use-cases/rides/reconcile-payment/reconcile-payment.handler.js';
import { StartRideHandler } from './use-cases/rides/start-ride/start-ride.handler.js';
import { UploadBatchHandler } from './use-cases/telemetry/upload-batch/upload-batch.handler.js';
import { SweepTelemetryHandler } from './use-cases/telemetry/sweep-telemetry/sweep-telemetry.handler.js';
import { SweepSignInsHandler } from './use-cases/auth/sweep-sign-ins/sweep-sign-ins.handler.js';
import { RejudgeRidesHandler } from './use-cases/admin/rejudge-rides/rejudge-rides.handler.js';
import { PostRideEventHandler } from './use-cases/live/post-ride-event/post-ride-event.handler.js';
import { AckEffectHandler } from './use-cases/live/ack-effect/ack-effect.handler.js';
import { GetInboxHandler } from './use-cases/live/get-inbox/get-inbox.handler.js';
import { WatchRideHandler } from './use-cases/live/watch-ride/watch-ride.handler.js';
import { GetRoadPlanHandler } from './use-cases/live/get-road-plan/get-road-plan.handler.js';
import { MuteWalletHandler } from './use-cases/live/mute-wallet/mute-wallet.handler.js';
import { SweepStaleRidesHandler } from './use-cases/rides/sweep-stale-rides/sweep-stale-rides.handler.js';
import { GetReplaysHandler } from './use-cases/lobby/get-replays/get-replays.handler.js';
import { CreateDonationOrderHandler } from './use-cases/live/create-donation-order/create-donation-order.handler.js';
import { ConfirmDonationHandler } from './use-cases/live/confirm-donation/confirm-donation.handler.js';
import { LiveAccessService } from './services/live-access.service.js';
import { GetAdminLogsHandler } from './use-cases/admin/get-admin-logs/get-admin-logs.handler.js';
import { GetAdminOverviewHandler } from './use-cases/admin/get-admin-overview/get-admin-overview.handler.js';
import { GetAdminRideHandler } from './use-cases/admin/get-admin-ride/get-admin-ride.handler.js';
import { ListAdminActionsHandler } from './use-cases/admin/list-admin-actions/list-admin-actions.handler.js';
import { ListAdminRidesHandler } from './use-cases/admin/list-admin-rides/list-admin-rides.handler.js';
import { ListAdminPlayersHandler } from './use-cases/admin/list-admin-players/list-admin-players.handler.js';
import { GetAdminPlayerHandler } from './use-cases/admin/get-admin-player/get-admin-player.handler.js';
import { GetAdminPoolHandler } from './use-cases/admin/get-admin-pool/get-admin-pool.handler.js';
import { GetAdminStatsHandler } from './use-cases/admin/get-admin-stats/get-admin-stats.handler.js';
import { ListAdminSessionsHandler } from './use-cases/admin/list-admin-sessions/list-admin-sessions.handler.js';
import { GetAdminQueueCountHandler } from './use-cases/admin/get-admin-queue-count/get-admin-queue-count.handler.js';
import { ListSignInsHandler } from './use-cases/admin/list-sign-ins/list-sign-ins.handler.js';
import { OverrideVerdictHandler } from './use-cases/admin/override-verdict/override-verdict.handler.js';
import { RejudgeRideHandler } from './use-cases/admin/rejudge-ride/rejudge-ride.handler.js';
import { RequestAdminChallengeHandler } from './use-cases/admin/request-admin-challenge/request-admin-challenge.handler.js';
import { VerifyAdminSignInHandler } from './use-cases/admin/verify-admin-signin/verify-admin-signin.handler.js';
import { RequestActionChallengeHandler } from './use-cases/admin/request-action-challenge/request-action-challenge.handler.js';

import { PoolTicketsService } from './services/pool-tickets.service.js';
import { PromoCreationService } from './services/promo-creation.service.js';
import { CreateAdminPromoHandler } from './use-cases/admin/create-admin-promo/create-admin-promo.handler.js';
import { DisableAdminPromoHandler } from './use-cases/admin/disable-admin-promo/disable-admin-promo.handler.js';
import { ListPromoRedemptionsHandler } from './use-cases/admin/list-promo-redemptions/list-promo-redemptions.handler.js';
import { EquipCosmeticHandler } from './use-cases/players/equip-cosmetic/equip-cosmetic.handler.js';
import { AcceptAgreementsHandler } from './use-cases/players/accept-agreements/accept-agreements.handler.js';
import { GetMyPromosHandler } from './use-cases/players/get-my-promos/get-my-promos.handler.js';
import { GetGarageHandler } from './use-cases/players/get-garage/get-garage.handler.js';
import { SaveGarageHandler } from './use-cases/players/save-garage/save-garage.handler.js';
import { GetWardrobeHandler } from './use-cases/players/get-wardrobe/get-wardrobe.handler.js';
import { TicketSettlementService } from './services/ticket-settlement.service.js';
import { PoolRegistryService } from './services/pool-registry.service.js';
import { GetTicketPaymentHandler } from './use-cases/tickets/get-ticket-payment/get-ticket-payment.handler.js';
import { ConfirmTicketOrderHandler } from './use-cases/tickets/confirm-ticket-order/confirm-ticket-order.handler.js';
import { GetRefundTransactionHandler } from './use-cases/pools/get-refund-transaction/get-refund-transaction.handler.js';
import { GetPayoutTransactionsHandler } from './use-cases/pools/get-payout-transactions/get-payout-transactions.handler.js';
import { SettleChainSignatureHandler } from './use-cases/chain/settle-chain-signature/settle-chain-signature.handler.js';
import { ListPoolsHandler } from './use-cases/pools/list-pools/list-pools.handler.js';
import { GetPrizePoolHandler } from './use-cases/pools/get-prize-pool/get-prize-pool.handler.js';
import { GetPoolStandingsHandler } from './use-cases/pools/get-pool-standings/get-pool-standings.handler.js';
import { HoldPoolPayoutHandler } from './use-cases/admin/hold-pool-payout/hold-pool-payout.handler.js';
import { ListAdminPoolsHandler } from './use-cases/admin/list-admin-pools/list-admin-pools.handler.js';
import { ListPoolPayoutsHandler } from './use-cases/admin/list-pool-payouts/list-pool-payouts.handler.js';
import { RedeemPromoHandler } from './use-cases/players/redeem-promo/redeem-promo.handler.js';

import { GetDonationPaymentHandler } from './use-cases/live/get-donation-payment/get-donation-payment.handler.js';
import { ReconcileDonationHandler } from './use-cases/live/reconcile-donation/reconcile-donation.handler.js';
import { GetSolanaPayLinkHandler, GetSolanaPayTransactionHandler } from './use-cases/solana-pay/solana-pay.handler.js';
import { ReconcileTicketOrderHandler } from './use-cases/tickets/reconcile-ticket-order/reconcile-ticket-order.handler.js';
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
import { CrankPoolsHandler } from './use-cases/chain/crank-pools/crank-pools.handler.js';
import { MintAchievementsHandler } from './use-cases/achievements/mint-achievements/mint-achievements.handler.js';
import { PayPoolsHandler } from './use-cases/chain/pay-pools/pay-pools.handler.js';
import { ReceiveChainWebhookHandler } from './use-cases/chain/receive-chain-webhook/receive-chain-webhook.handler.js';
import { RegisterPoolFromChainHandler } from './use-cases/pools/register-pool-from-chain/register-pool-from-chain.handler.js';
import { AdjustFreeRidesHandler } from './use-cases/admin/adjust-free-rides/adjust-free-rides.handler.js';
import { GetSettingsHandler } from './use-cases/admin/get-settings/get-settings.handler.js';
import { UpdateSettingHandler } from './use-cases/admin/update-setting/update-setting.handler.js';
import { GetSnsReverseHandler } from './use-cases/sns/get-sns-reverse/get-sns-reverse.handler.js';
import { ResolveSnsHandler } from './use-cases/sns/resolve-sns/resolve-sns.handler.js';
import { GetActionsJsonHandler } from './use-cases/actions/get-actions-json.handler.js';
import { GetHelloActionHandler, SayHelloActionHandler } from './use-cases/actions/hello-action.handler.js';
import { GetShiftActionHandler, PrepareShiftActionHandler, OpenSiteActionHandler } from './use-cases/actions/shift-action.handler.js';
import { GetRideActionHandler, OpenRideActionHandler } from './use-cases/actions/ride-action.handler.js';
import { CreatePledgeHandler } from './use-cases/pledges/create-pledge/create-pledge.handler.js';
import { ConfirmPledgeHandler } from './use-cases/pledges/confirm-pledge/confirm-pledge.handler.js';
import { SyncPledgesHandler } from './use-cases/pledges/sync-pledges/sync-pledges.handler.js';
import { GetRidePledgesHandler } from './use-cases/pledges/get-ride-pledges/get-ride-pledges.handler.js';
import { GetPledgeHandler } from './use-cases/pledges/get-pledge/get-pledge.handler.js';

const services: Provider[] = [
  EntityCatalogService, EntityWriteService, EditorAgentService, EditorJobRunnerService,
  AchievementService, PaymentSettlementService, PlayerSessionService, GameSettingsService, RideLookupService, RoundService, VerdictService, AdminProofService,
  PoolTicketsService, PromoCreationService, TicketSettlementService, PoolRegistryService, FinalityService, LiveAccessService, StatsService, MeProfileService, PoolAttentionService, AttestationService,
];

import { ReconcileStatsHandler } from './use-cases/stats/reconcile-stats/reconcile-stats.handler.js';
import { GetDailyStatsHandler } from './use-cases/stats/get-daily-stats/get-daily-stats.handler.js';
import { GetStatsHandler } from './use-cases/stats/get-stats/get-stats.handler.js';
import { GetRideReplaysHandler } from './use-cases/verdict/get-ride-replays/get-ride-replays.handler.js';
import { ProcessReplayQueueHandler } from './use-cases/verdict/process-replay-queue/process-replay-queue.handler.js';
import { ListAdminReplaysHandler } from './use-cases/admin/list-admin-replays/list-admin-replays.handler.js';
import { EntityCatalogService } from './services/entity-catalog.service.js';
import { EntityWriteService } from './services/entity-write.service.js';
import { GetEntityBundleHandler } from './use-cases/entities/get-entity-bundle/get-entity-bundle.handler.js';
import { ListEntitiesHandler } from './use-cases/entities/list-entities/list-entities.handler.js';
import { GetEntityHandler } from './use-cases/entities/get-entity/get-entity.handler.js';
import { ListRevisionsHandler } from './use-cases/entities/list-revisions/list-revisions.handler.js';
import { GetRevisionHandler } from './use-cases/entities/get-revision/get-revision.handler.js';
import { SaveDraftHandler } from './use-cases/entities/save-draft/save-draft.handler.js';
import { RestoreRevisionHandler } from './use-cases/entities/restore-revision/restore-revision.handler.js';
import { RequestPublishChallengeHandler } from './use-cases/entities/request-publish-challenge/request-publish-challenge.handler.js';
import { PublishRevisionHandler } from './use-cases/entities/publish-revision/publish-revision.handler.js';
import { RequestEditorChallengeHandler } from './use-cases/editor/request-editor-challenge/request-editor-challenge.handler.js';
import { VerifyEditorSignInHandler } from './use-cases/editor/verify-editor-signin/verify-editor-signin.handler.js';
import { EditorAgentService } from './services/editor-agent.service.js';
import { EditorJobRunnerService } from './services/editor-job-runner.service.js';
import { CreateEditorJobHandler } from './use-cases/editor/create-editor-job/create-editor-job.handler.js';
import { CancelEditorJobHandler } from './use-cases/editor/cancel-editor-job/cancel-editor-job.handler.js';
import { ListEditorJobsHandler } from './use-cases/editor/list-editor-jobs/list-editor-jobs.handler.js';
import { GetEditorJobHandler } from './use-cases/editor/get-editor-job/get-editor-job.handler.js';
import { GetEditorJobEventsHandler } from './use-cases/editor/get-editor-job-events/get-editor-job-events.handler.js';
import { SweepEditorJobsHandler } from './use-cases/editor/sweep-editor-jobs/sweep-editor-jobs.handler.js';
import { McpConfigsHandler } from './use-cases/editor/mcp-configs/mcp-configs.handler.js';
import { McpSaveDraftHandler } from './use-cases/editor/mcp-save-draft/mcp-save-draft.handler.js';
import { GetEditorMeHandler } from './use-cases/editor/get-editor-me/get-editor-me.handler.js';

const handlers: Provider[] = [
  CreateEditorJobHandler, CancelEditorJobHandler, ListEditorJobsHandler, GetEditorJobHandler, GetEditorJobEventsHandler, SweepEditorJobsHandler, McpConfigsHandler, McpSaveDraftHandler,
  GetEntityBundleHandler, ListEntitiesHandler, GetEntityHandler, ListRevisionsHandler, GetRevisionHandler, SaveDraftHandler, RestoreRevisionHandler, RequestPublishChallengeHandler, PublishRevisionHandler, RequestEditorChallengeHandler, VerifyEditorSignInHandler, GetEditorMeHandler,
  GetStatsHandler, GetDailyStatsHandler, ReconcileStatsHandler,
  RequestChallengeHandler, VerifySignInHandler, GetMeHandler, LogoutHandler,
  CreateRideHandler, GetRideHandler, GetPendingRideHandler, GetPublicRideHandler, StartRideHandler, HeartbeatRideHandler, EndRideHandler,
  GetPaymentInstructionsHandler, ConfirmPaymentHandler, ReconcilePaymentHandler,
  UploadBatchHandler, SweepTelemetryHandler, SweepSignInsHandler, RejudgeRidesHandler, GetRideReplaysHandler, ProcessReplayQueueHandler,
  PostRideEventHandler, AckEffectHandler, GetInboxHandler, WatchRideHandler, GetRoadPlanHandler, MuteWalletHandler, CreateDonationOrderHandler, ConfirmDonationHandler, GetDonationPaymentHandler, ReconcileDonationHandler, SweepStaleRidesHandler, GetReplaysHandler,
  GetAdminQueueCountHandler, ListAdminPlayersHandler, GetAdminPlayerHandler, ListAdminPoolsHandler, GetAdminPoolHandler, GetAdminStatsHandler, ListAdminSessionsHandler, GetAdminOverviewHandler, ListAdminRidesHandler, ListAdminReplaysHandler, GetAdminRideHandler, ListSignInsHandler, ListAdminActionsHandler, GetAdminLogsHandler, OverrideVerdictHandler, RejudgeRideHandler, RequestAdminChallengeHandler, VerifyAdminSignInHandler, RequestActionChallengeHandler,
  GetTiersHandler, GetPoolHandler, GetLeaderboardHandler,
  GetLiveHandler, GetProfileHandler,
  GetLivenessHandler, GetReadinessHandler,
  GrantDailyFreeRidesHandler,
  RecordTelemetryHandler,
  ListPoolsHandler, GetPrizePoolHandler, GetPoolStandingsHandler, HoldPoolPayoutHandler, ListPoolPayoutsHandler, RedeemPromoHandler, GetMyPromosHandler, GetWardrobeHandler, EquipCosmeticHandler, AcceptAgreementsHandler, GetGarageHandler, SaveGarageHandler,
  CreateAdminPromoHandler, DisableAdminPromoHandler, ListPromoRedemptionsHandler,
  CreatePromoHandler, ListPromosHandler, DisablePromoHandler, GrantTicketsHandler, RegisterPoolHandler,
  CreateTicketOrderHandler, GetTicketOrderHandler, GetPendingTicketOrderHandler,
  SettleChainSignatureHandler, GetTicketPaymentHandler, ConfirmTicketOrderHandler, ReconcileTicketOrderHandler,
  GetSolanaPayLinkHandler, GetSolanaPayTransactionHandler,
  GetRefundTransactionHandler, GetPayoutTransactionsHandler,
  GetChainFeesHandler,
  PollProgramHandler, SyncPoolsHandler, CrankPoolsHandler, PayPoolsHandler, MintAchievementsHandler, ReceiveChainWebhookHandler, RegisterPoolFromChainHandler,
  AdjustFreeRidesHandler, GetSettingsHandler, UpdateSettingHandler,
  GetSnsReverseHandler, ResolveSnsHandler,
  GetActionsJsonHandler, GetHelloActionHandler, SayHelloActionHandler, GetShiftActionHandler, PrepareShiftActionHandler, OpenSiteActionHandler, GetRideActionHandler, OpenRideActionHandler,
  CreatePledgeHandler, ConfirmPledgeHandler, SyncPledgesHandler, GetRidePledgesHandler, GetPledgeHandler,
];

@Module({
  imports: [CqrsModule.forRoot(), InfrastructureModule],
  providers: [...services, ...handlers],
  exports: [CqrsModule, InfrastructureModule, PoolAttentionService], // PoolAttentionService: the payout job marks a pool before it pays
})
export class ApplicationModule {}
