import { Module, type Provider } from '@nestjs/common';
import { EnvService } from './config/env.service.js';
import { AchievementMintRepositoryPort } from '../application/ports/achievements/achievement-mint.repository.port.js';
import { AchievementMintChainPort } from '../application/ports/achievements/achievement-mint-chain.port.js';
import { AchievementMintPrismaRepository } from './prisma/repositories/achievement-mint.prisma.repository.js';
import { BubblegumMintAdapter } from './solana/bubblegum-mint.adapter.js';
import { AchievementRepositoryPort } from '../application/ports/achievements/achievement.repository.port.js';
import { ChallengeRepositoryPort } from '../application/ports/auth/challenge.repository.port.js';
import { SignatureVerifierPort } from '../application/ports/auth/signature-verifier.port.js';
import { TokenSignerPort } from '../application/ports/auth/token-signer.port.js';
import { RulesConfigPort } from '../application/ports/config/rules-config.port.js';
import { ChainPort } from '../application/ports/economy/chain.port.js';
import { PaymentRepositoryPort } from '../application/ports/economy/payment.repository.port.js';
import { PoolChainPort } from '../application/ports/economy/pool-chain.port.js';
import { PoolCrankChainPort } from '../application/ports/economy/pool-crank-chain.port.js';
import { ChainCursorRepositoryPort, ChainEventRepositoryPort } from '../application/ports/economy/chain-event.repository.port.js';
import { PriceQuotePort } from '../application/ports/economy/price-quote.port.js';
import { RoundRepositoryPort } from '../application/ports/economy/round.repository.port.js';
import { HealthProbePort } from '../application/ports/health/health-probe.port.js';
import { DailySeedRepositoryPort } from '../application/ports/rides/daily-seed.repository.port.js';
import { PlayerRepositoryPort } from '../application/ports/players/player.repository.port.js';
import { SettingsRepositoryPort } from '../application/ports/settings/settings.repository.port.js';
import { RideQueryPort } from '../application/ports/rides/ride-query.port.js';
import { RideRepositoryPort } from '../application/ports/rides/ride.repository.port.js';
import { WeeklyTicketRepositoryPort } from '../application/ports/prize/weekly-ticket.repository.port.js';
import { WeeklyTicketPrismaRepository } from './prisma/repositories/weekly-ticket.prisma.repository.js';
import { GeoLocatorPort } from '../application/ports/prize/geo-locator.port.js';
import { PrizeGeoPort } from '../application/ports/prize/prize-geo.port.js';
import { HeaderGeoAdapter } from './prize/header-geo.adapter.js';
import { EnvPrizeGeoAdapter } from './prize/env-prize-geo.adapter.js';
import { AnalyticsPort } from '../application/ports/analytics/analytics.port.js';
import { ClockPort } from '../application/ports/shared/clock.port.js';
import { EntropyPort } from '../application/ports/shared/entropy.port.js';
import { HasherPort } from '../application/ports/shared/hasher.port.js';
import { LogBufferPort } from '../application/ports/ops/log-buffer.port.js';
import { TransactionPort } from '../application/ports/shared/transaction.port.js';
import { RideBatchRepositoryPort } from '../application/ports/telemetry/ride-batch.repository.port.js';
import { RideVerdictRepositoryPort } from '../application/ports/verdict/ride-verdict.repository.port.js';
import { SignInRepositoryPort } from '../application/ports/auth/sign-in.repository.port.js';
import { AdminActionRepositoryPort } from '../application/ports/admin/admin-action.repository.port.js';
import { AdminDirectoryPort } from '../application/ports/admin/admin-directory.port.js';
import { AdminQueryPort } from '../application/ports/admin/admin-query.port.js';
import { PostHogAnalyticsAdapter } from './analytics/posthog-analytics.adapter.js';
import { JoseTokenSigner } from './auth/jose.token-signer.js';
import { JoseAdminTokenSigner } from './auth/jose.admin-token-signer.js';
import { AdminTokenPort } from '../application/ports/admin/admin-token.port.js';
import { NaclSignatureVerifier } from './auth/nacl.signature-verifier.js';
import { EnvRulesConfigAdapter } from './config/rules-config.adapter.js';
import { NodeEntropy } from './crypto/node.entropy.js';
import { NodeHasher } from './crypto/node.hasher.js';
import { JsonLogger } from './logging/json-logger.js';
import { LogRing } from './logging/log-ring.js';
import { RingLogBufferAdapter } from './logging/ring-log-buffer.adapter.js';
import { RideBatchPrismaRepository } from './prisma/repositories/ride-batch.prisma.repository.js';
import { RideVerdictPrismaRepository } from './prisma/repositories/ride-verdict.prisma.repository.js';
import { SignInPrismaRepository } from './prisma/repositories/sign-in.prisma.repository.js';
import { AdminActionPrismaRepository } from './prisma/repositories/admin-action.prisma.repository.js';
import { AdminDirectoryPrismaRepository } from './prisma/repositories/admin-directory.prisma.repository.js';
import { AdminQueryPrismaRepository } from './prisma/repositories/admin-query.prisma.repository.js';
import { AdminGuard } from './http/guards/admin.guard.js';
import { PrismaHealthProbe } from './health/prisma.health-probe.js';
import { AchievementPrismaRepository } from './prisma/repositories/achievement.prisma.repository.js';
import { ChallengePrismaRepository } from './prisma/repositories/challenge.prisma.repository.js';
import { PaymentPrismaRepository } from './prisma/repositories/payment.prisma.repository.js';
import { DailySeedPrismaRepository } from './prisma/repositories/daily-seed.prisma.repository.js';
import { PlayerPrismaRepository } from './prisma/repositories/player.prisma.repository.js';
import { SettingsPrismaRepository } from './prisma/repositories/settings.prisma.repository.js';
import { RideQueryPrismaRepository } from './prisma/repositories/ride-query.prisma.repository.js';
import { RidePrismaRepository } from './prisma/repositories/ride.prisma.repository.js';
import { RoundPrismaRepository } from './prisma/repositories/round.prisma.repository.js';
import { PrismaService } from './prisma/prisma.service.js';
import { TransactionPrismaAdapter } from './prisma/transaction.prisma.adapter.js';
import { HttpPriceQuoteAdapter } from './solana/http-price-quote.adapter.js';
import { SolanaChainAdapter } from './solana/solana-chain.adapter.js';
import { ProgramChainAdapter } from './solana/program-chain.adapter.js';
import { ProgramCrankAdapter } from './solana/program-crank.adapter.js';
import { ProgramPayoutAdapter } from './solana/program-payout.adapter.js';
import { PoolPayoutChainPort } from '../application/ports/economy/pool-payout-chain.port.js';
import { PoolPayoutRepositoryPort } from '../application/ports/economy/pool-payout.repository.port.js';
import { PoolPayoutPrismaRepository } from './prisma/repositories/pool-payout.prisma.repository.js';
import { PledgeRepositoryPort } from '../application/ports/economy/pledge.repository.port.js';
import { PledgePrismaRepository } from './prisma/repositories/pledge.prisma.repository.js';
import { ChainCursorPrismaRepository } from './prisma/repositories/chain-cursor.prisma.repository.js';
import { ChainEventPrismaRepository } from './prisma/repositories/chain-event.prisma.repository.js';
import { SystemClock } from './time/system.clock.js';
import { OptionalSessionGuard } from './http/guards/optional-session.guard.js';
import { PlayerAuthGuard } from './http/guards/player-auth.guard.js';
import { ClearSessionCookieInterceptor, SetSessionCookieInterceptor } from './http/interceptors/session-cookie.interceptor.js';
import { PoolRepositoryPort } from '../application/ports/economy/pool.repository.port.js';
import { PromoRepositoryPort } from '../application/ports/economy/promo.repository.port.js';
import { RideTicketRepositoryPort } from '../application/ports/players/ride-ticket.repository.port.js';
import { PoolPrismaRepository } from './prisma/repositories/pool.prisma.repository.js';
import { TicketOrderRepositoryPort } from '../application/ports/economy/ticket-order.repository.port.js';
import { TicketOrderPrismaRepository } from './prisma/repositories/ticket-order.prisma.repository.js';
import { CosmeticRepositoryPort } from '../application/ports/players/cosmetic.repository.port.js';
import { HonkRepositoryPort } from '../application/ports/honk/honk.repository.port.js';
import { HonkChainPort } from '../application/ports/honk/honk-chain.port.js';
import { HonkEmissionPort } from '../application/ports/honk/honk-emission.port.js';
import { HonkPrismaRepository } from './prisma/repositories/honk.prisma.repository.js';
import { HonkChainAdapter } from './solana/honk-chain.adapter.js';
import { HonkEmissionAdapter } from './solana/honk-emission.adapter.js';
import { CosmeticPrismaRepository } from './prisma/repositories/cosmetic.prisma.repository.js';
import { PromoPrismaRepository } from './prisma/repositories/promo.prisma.repository.js';
import { RideTicketPrismaRepository } from './prisma/repositories/ride-ticket.prisma.repository.js';
import { ClearAdminCookieInterceptor, SetAdminCookieInterceptor } from './http/interceptors/admin-cookie.interceptor.js';
import { RideEventRepositoryPort } from '../application/ports/live/ride-event.repository.port.js';
import { ViewerPresencePort } from '../application/ports/live/viewer-presence.port.js';
import { RideEventPrismaRepository } from './prisma/repositories/ride-event.prisma.repository.js';
import { RideMuteRepositoryPort } from '../application/ports/live/ride-mute.repository.port.js';
import { RideMutePrismaRepository } from './prisma/repositories/ride-mute.prisma.repository.js';
import { DonationOrderRepositoryPort } from '../application/ports/live/donation-order.repository.port.js';
import { DonationOrderPrismaRepository } from './prisma/repositories/donation-order.prisma.repository.js';
import { CachePort } from '../application/ports/shared/cache.port.js';
import { StatsRepositoryPort } from '../application/ports/stats/stats.repository.port.js';
import { StatsPrismaRepository } from './prisma/repositories/stats.prisma.repository.js';
import { MemoryCacheAdapter } from './cache/memory-cache.adapter.js';
import { RedisCacheAdapter } from './cache/redis-cache.adapter.js';
import { RateLimitStorage, RedisThrottlerStorage } from './http/redis-throttler.storage.js';
import { MemoryViewerPresenceAdapter } from './live/viewer-presence.memory.adapter.js';
import { RedisViewerPresenceAdapter } from './live/viewer-presence.redis.adapter.js';
import { SitePresencePort } from '../application/ports/live/site-presence.port.js';
import { MemorySitePresenceAdapter } from './live/site-presence.memory.adapter.js';
import { RedisSitePresenceAdapter } from './live/site-presence.redis.adapter.js';
import { NameServicePort } from '../application/ports/sns/name-service.port.js';
import { SnsNameServiceAdapter } from './sns/sns-name-service.adapter.js';
import { RideReplayRepositoryPort } from '../application/ports/verdict/ride-replay.repository.port.js';
import { RideReplayPrismaRepository } from './prisma/repositories/ride-replay.prisma.repository.js';
import { ReplayQueuePort } from '../application/ports/verdict/replay-queue.port.js';
import { MemoryReplayQueueAdapter } from './verdict/memory-replay-queue.adapter.js';
import { RedisReplayQueueAdapter } from './verdict/redis-replay-queue.adapter.js';
import { EntityRepositoryPort } from '../application/ports/entities/entity.repository.port.js';
import { EntityPrismaRepository } from './prisma/repositories/entity.prisma.repository.js';
import { EditorTokenPort } from '../application/ports/editor/editor-token.port.js';
import { JoseEditorTokenSigner } from './auth/jose.editor-token-signer.js';
import { EditorGuard } from './http/guards/editor.guard.js';
import { LlmProviderPort } from '../application/ports/editor/llm-provider.port.js';
import { LlmRegistryAdapter } from './llm/llm-registry.adapter.js';
import { McpClientPort } from '../application/ports/editor/mcp-client.port.js';
import { McpSdkClientAdapter } from './mcp/mcp-sdk.client.adapter.js';
import { JobTokenPort } from '../application/ports/editor/job-token.port.js';
import { JoseJobTokenSigner } from './auth/jose.job-token-signer.js';
import { EditorJobRepositoryPort } from '../application/ports/editor/editor-job.repository.port.js';
import { EditorJobPrismaRepository } from './prisma/repositories/editor-job.prisma.repository.js';
import { McpJobGuard } from './http/guards/mcp-job.guard.js';
import { ClearEditorCookieInterceptor, SetEditorCookieInterceptor } from './http/interceptors/editor-cookie.interceptor.js';

/** Every port the application layer declares is bound to its adapter here – the only place that knows which implementation runs. */
const ports: Provider[] = [
  { provide: ClockPort, useClass: SystemClock },
  { provide: EntropyPort, useClass: NodeEntropy },
  { provide: HasherPort, useClass: NodeHasher },
  { provide: LogBufferPort, useClass: RingLogBufferAdapter },
  { provide: RideBatchRepositoryPort, useClass: RideBatchPrismaRepository },
  { provide: RideVerdictRepositoryPort, useClass: RideVerdictPrismaRepository },
  { provide: RideReplayRepositoryPort, useClass: RideReplayPrismaRepository },
  { provide: ReplayQueuePort, inject: [EnvService, ClockPort], useFactory: (env: EnvService, clock: ClockPort): ReplayQueuePort => (env.redisUrl ? new RedisReplayQueueAdapter(env.redisUrl, clock) : new MemoryReplayQueueAdapter()) },
  { provide: SignInRepositoryPort, useClass: SignInPrismaRepository },
  { provide: AdminActionRepositoryPort, useClass: AdminActionPrismaRepository },
  { provide: AdminQueryPort, useClass: AdminQueryPrismaRepository },
  { provide: AdminDirectoryPort, useClass: AdminDirectoryPrismaRepository },
  { provide: TransactionPort, useClass: TransactionPrismaAdapter },
  { provide: RulesConfigPort, useClass: EnvRulesConfigAdapter },
  { provide: PlayerRepositoryPort, useClass: PlayerPrismaRepository },
  { provide: SettingsRepositoryPort, useClass: SettingsPrismaRepository },
  { provide: ChallengeRepositoryPort, useClass: ChallengePrismaRepository },
  { provide: SignatureVerifierPort, useClass: NaclSignatureVerifier },
  { provide: TokenSignerPort, useClass: JoseTokenSigner },
  { provide: AdminTokenPort, useClass: JoseAdminTokenSigner },
  { provide: EditorTokenPort, useClass: JoseEditorTokenSigner },
  { provide: EntityRepositoryPort, useClass: EntityPrismaRepository },
  { provide: LlmProviderPort, useClass: LlmRegistryAdapter },
  { provide: McpClientPort, useClass: McpSdkClientAdapter },
  { provide: JobTokenPort, useClass: JoseJobTokenSigner },
  { provide: EditorJobRepositoryPort, useClass: EditorJobPrismaRepository },
  { provide: RideRepositoryPort, useClass: RidePrismaRepository },
  { provide: DailySeedRepositoryPort, useClass: DailySeedPrismaRepository },
  { provide: RideQueryPort, useClass: RideQueryPrismaRepository },
  { provide: RoundRepositoryPort, useClass: RoundPrismaRepository },
  { provide: PaymentRepositoryPort, useClass: PaymentPrismaRepository },
  { provide: AchievementRepositoryPort, useClass: AchievementPrismaRepository },
  { provide: AchievementMintRepositoryPort, useClass: AchievementMintPrismaRepository },
  { provide: AchievementMintChainPort, useClass: BubblegumMintAdapter },
  { provide: PriceQuotePort, useClass: HttpPriceQuoteAdapter },
  { provide: ChainPort, useClass: SolanaChainAdapter },
  { provide: HealthProbePort, useClass: PrismaHealthProbe },
  { provide: PoolRepositoryPort, useClass: PoolPrismaRepository },
  { provide: RideTicketRepositoryPort, useClass: RideTicketPrismaRepository },
  { provide: PromoRepositoryPort, useClass: PromoPrismaRepository },
  { provide: CosmeticRepositoryPort, useClass: CosmeticPrismaRepository },
  { provide: HonkRepositoryPort, useClass: HonkPrismaRepository },
  { provide: HonkChainPort, useClass: HonkChainAdapter },
  { provide: HonkEmissionPort, useClass: HonkEmissionAdapter },
  { provide: TicketOrderRepositoryPort, useClass: TicketOrderPrismaRepository },
  { provide: PoolChainPort, useClass: ProgramChainAdapter },
  { provide: PoolCrankChainPort, useClass: ProgramCrankAdapter },
  { provide: PoolPayoutChainPort, useClass: ProgramPayoutAdapter },
  { provide: PoolPayoutRepositoryPort, useClass: PoolPayoutPrismaRepository },
  { provide: PledgeRepositoryPort, useClass: PledgePrismaRepository },
  { provide: ChainEventRepositoryPort, useClass: ChainEventPrismaRepository },
  { provide: ChainCursorRepositoryPort, useClass: ChainCursorPrismaRepository },
  { provide: RideEventRepositoryPort, useClass: RideEventPrismaRepository },
  { provide: ViewerPresencePort, inject: [EnvService, ClockPort], useFactory: (env: EnvService, clock: ClockPort): ViewerPresencePort => (env.redisUrl ? new RedisViewerPresenceAdapter(env.redisUrl, clock) : new MemoryViewerPresenceAdapter()) },
  { provide: SitePresencePort, inject: [EnvService, ClockPort], useFactory: (env: EnvService, clock: ClockPort): SitePresencePort => (env.redisUrl ? new RedisSitePresenceAdapter(env.redisUrl, clock) : new MemorySitePresenceAdapter()) },
  { provide: RideMuteRepositoryPort, useClass: RideMutePrismaRepository },
  { provide: DonationOrderRepositoryPort, useClass: DonationOrderPrismaRepository },
  { provide: AnalyticsPort, useClass: PostHogAnalyticsAdapter },
  { provide: StatsRepositoryPort, useClass: StatsPrismaRepository },
  { provide: CachePort, inject: [EnvService, ClockPort], useFactory: (env: EnvService, clock: ClockPort): CachePort => (env.redisUrl ? new RedisCacheAdapter(env.redisUrl, clock) : new MemoryCacheAdapter(clock)) },
  { provide: RateLimitStorage, inject: [EnvService, ClockPort], useFactory: (env: EnvService, clock: ClockPort): RedisThrottlerStorage | null => (env.redisUrl ? RedisThrottlerStorage.connect(env.redisUrl, clock) : null) },
  { provide: NameServicePort, useClass: SnsNameServiceAdapter },
  { provide: WeeklyTicketRepositoryPort, useClass: WeeklyTicketPrismaRepository },
  { provide: GeoLocatorPort, useClass: HeaderGeoAdapter },
  { provide: PrizeGeoPort, useClass: EnvPrizeGeoAdapter },
];

const portTokens = ports.map((p) => (p as { provide: unknown }).provide as typeof ClockPort);

@Module({
  providers: [PrismaService, PlayerAuthGuard, AdminGuard, OptionalSessionGuard, SetSessionCookieInterceptor, ClearSessionCookieInterceptor, SetAdminCookieInterceptor, ClearAdminCookieInterceptor, EditorGuard, McpJobGuard, SetEditorCookieInterceptor, ClearEditorCookieInterceptor, { provide: LogRing, useValue: new LogRing() }, JsonLogger, ...ports],
  exports: [PrismaService, PlayerAuthGuard, AdminGuard, OptionalSessionGuard, SetSessionCookieInterceptor, ClearSessionCookieInterceptor, SetAdminCookieInterceptor, ClearAdminCookieInterceptor, EditorGuard, McpJobGuard, SetEditorCookieInterceptor, ClearEditorCookieInterceptor, LogRing, JsonLogger, RateLimitStorage, ...portTokens],
})
export class InfrastructureModule {}
