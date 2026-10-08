import { Module, type Provider } from '@nestjs/common';
import { AchievementRepositoryPort } from '../application/ports/achievements/achievement.repository.port.js';
import { ChallengeRepositoryPort } from '../application/ports/auth/challenge.repository.port.js';
import { SignatureVerifierPort } from '../application/ports/auth/signature-verifier.port.js';
import { TokenSignerPort } from '../application/ports/auth/token-signer.port.js';
import { RulesConfigPort } from '../application/ports/config/rules-config.port.js';
import { ChainPort } from '../application/ports/economy/chain.port.js';
import { PaymentRepositoryPort } from '../application/ports/economy/payment.repository.port.js';
import { PoolChainPort } from '../application/ports/economy/pool-chain.port.js';
import { ChainCursorRepositoryPort, ChainEventRepositoryPort } from '../application/ports/economy/chain-event.repository.port.js';
import { SponsoredTxRepositoryPort } from '../application/ports/economy/sponsored-tx.repository.port.js';
import { PriceQuotePort } from '../application/ports/economy/price-quote.port.js';
import { RoundRepositoryPort } from '../application/ports/economy/round.repository.port.js';
import { HealthProbePort } from '../application/ports/health/health-probe.port.js';
import { PlayerRepositoryPort } from '../application/ports/players/player.repository.port.js';
import { RideQueryPort } from '../application/ports/rides/ride-query.port.js';
import { RideRepositoryPort } from '../application/ports/rides/ride.repository.port.js';
import { ClockPort } from '../application/ports/shared/clock.port.js';
import { EntropyPort } from '../application/ports/shared/entropy.port.js';
import { HasherPort } from '../application/ports/shared/hasher.port.js';
import { LogBufferPort } from '../application/ports/ops/log-buffer.port.js';
import { TransactionPort } from '../application/ports/shared/transaction.port.js';
import { RideBatchRepositoryPort } from '../application/ports/telemetry/ride-batch.repository.port.js';
import { RideVerdictRepositoryPort } from '../application/ports/verdict/ride-verdict.repository.port.js';
import { SignInRepositoryPort } from '../application/ports/auth/sign-in.repository.port.js';
import { AdminActionRepositoryPort } from '../application/ports/admin/admin-action.repository.port.js';
import { AdminQueryPort } from '../application/ports/admin/admin-query.port.js';
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
import { AdminQueryPrismaRepository } from './prisma/repositories/admin-query.prisma.repository.js';
import { AdminGuard } from './http/guards/admin.guard.js';
import { PrismaHealthProbe } from './health/prisma.health-probe.js';
import { AchievementPrismaRepository } from './prisma/repositories/achievement.prisma.repository.js';
import { ChallengePrismaRepository } from './prisma/repositories/challenge.prisma.repository.js';
import { PaymentPrismaRepository } from './prisma/repositories/payment.prisma.repository.js';
import { PlayerPrismaRepository } from './prisma/repositories/player.prisma.repository.js';
import { RideQueryPrismaRepository } from './prisma/repositories/ride-query.prisma.repository.js';
import { RidePrismaRepository } from './prisma/repositories/ride.prisma.repository.js';
import { RoundPrismaRepository } from './prisma/repositories/round.prisma.repository.js';
import { PrismaService } from './prisma/prisma.service.js';
import { TransactionPrismaAdapter } from './prisma/transaction.prisma.adapter.js';
import { HttpPriceQuoteAdapter } from './solana/http-price-quote.adapter.js';
import { SolanaChainAdapter } from './solana/solana-chain.adapter.js';
import { ProgramChainAdapter } from './solana/program-chain.adapter.js';
import { ChainCursorPrismaRepository } from './prisma/repositories/chain-cursor.prisma.repository.js';
import { ChainEventPrismaRepository } from './prisma/repositories/chain-event.prisma.repository.js';
import { SponsoredTxPrismaRepository } from './prisma/repositories/sponsored-tx.prisma.repository.js';
import { SystemClock } from './time/system.clock.js';
import { PlayerAuthGuard } from './http/guards/player-auth.guard.js';
import { ClearSessionCookieInterceptor, SetSessionCookieInterceptor } from './http/interceptors/session-cookie.interceptor.js';
import { PoolRepositoryPort } from '../application/ports/economy/pool.repository.port.js';
import { PromoRepositoryPort } from '../application/ports/economy/promo.repository.port.js';
import { RideTicketRepositoryPort } from '../application/ports/players/ride-ticket.repository.port.js';
import { PoolPrismaRepository } from './prisma/repositories/pool.prisma.repository.js';
import { TicketOrderRepositoryPort } from '../application/ports/economy/ticket-order.repository.port.js';
import { TicketOrderPrismaRepository } from './prisma/repositories/ticket-order.prisma.repository.js';
import { PromoPrismaRepository } from './prisma/repositories/promo.prisma.repository.js';
import { RideTicketPrismaRepository } from './prisma/repositories/ride-ticket.prisma.repository.js';
import { ClearAdminCookieInterceptor, SetAdminCookieInterceptor } from './http/interceptors/admin-cookie.interceptor.js';
import { RideEventRepositoryPort } from '../application/ports/live/ride-event.repository.port.js';
import { ViewerPresencePort } from '../application/ports/live/viewer-presence.port.js';
import { RideEventPrismaRepository } from './prisma/repositories/ride-event.prisma.repository.js';
import { MemoryViewerPresenceAdapter } from './live/viewer-presence.memory.adapter.js';

/** Every port the application layer declares is bound to its adapter here – the only place that knows which implementation runs. */
const ports: Provider[] = [
  { provide: ClockPort, useClass: SystemClock },
  { provide: EntropyPort, useClass: NodeEntropy },
  { provide: HasherPort, useClass: NodeHasher },
  { provide: LogBufferPort, useClass: RingLogBufferAdapter },
  { provide: RideBatchRepositoryPort, useClass: RideBatchPrismaRepository },
  { provide: RideVerdictRepositoryPort, useClass: RideVerdictPrismaRepository },
  { provide: SignInRepositoryPort, useClass: SignInPrismaRepository },
  { provide: AdminActionRepositoryPort, useClass: AdminActionPrismaRepository },
  { provide: AdminQueryPort, useClass: AdminQueryPrismaRepository },
  { provide: TransactionPort, useClass: TransactionPrismaAdapter },
  { provide: RulesConfigPort, useClass: EnvRulesConfigAdapter },
  { provide: PlayerRepositoryPort, useClass: PlayerPrismaRepository },
  { provide: ChallengeRepositoryPort, useClass: ChallengePrismaRepository },
  { provide: SignatureVerifierPort, useClass: NaclSignatureVerifier },
  { provide: TokenSignerPort, useClass: JoseTokenSigner },
  { provide: AdminTokenPort, useClass: JoseAdminTokenSigner },
  { provide: RideRepositoryPort, useClass: RidePrismaRepository },
  { provide: RideQueryPort, useClass: RideQueryPrismaRepository },
  { provide: RoundRepositoryPort, useClass: RoundPrismaRepository },
  { provide: PaymentRepositoryPort, useClass: PaymentPrismaRepository },
  { provide: AchievementRepositoryPort, useClass: AchievementPrismaRepository },
  { provide: PriceQuotePort, useClass: HttpPriceQuoteAdapter },
  { provide: ChainPort, useClass: SolanaChainAdapter },
  { provide: HealthProbePort, useClass: PrismaHealthProbe },
  { provide: PoolRepositoryPort, useClass: PoolPrismaRepository },
  { provide: RideTicketRepositoryPort, useClass: RideTicketPrismaRepository },
  { provide: PromoRepositoryPort, useClass: PromoPrismaRepository },
  { provide: TicketOrderRepositoryPort, useClass: TicketOrderPrismaRepository },
  { provide: PoolChainPort, useClass: ProgramChainAdapter },
  { provide: ChainEventRepositoryPort, useClass: ChainEventPrismaRepository },
  { provide: ChainCursorRepositoryPort, useClass: ChainCursorPrismaRepository },
  { provide: SponsoredTxRepositoryPort, useClass: SponsoredTxPrismaRepository },
  { provide: RideEventRepositoryPort, useClass: RideEventPrismaRepository },
  { provide: ViewerPresencePort, useClass: MemoryViewerPresenceAdapter },
];

const portTokens = ports.map((p) => (p as { provide: unknown }).provide as typeof ClockPort);

@Module({
  providers: [PrismaService, PlayerAuthGuard, AdminGuard, SetSessionCookieInterceptor, ClearSessionCookieInterceptor, SetAdminCookieInterceptor, ClearAdminCookieInterceptor, { provide: LogRing, useValue: new LogRing() }, JsonLogger, ...ports],
  exports: [PrismaService, PlayerAuthGuard, AdminGuard, SetSessionCookieInterceptor, ClearSessionCookieInterceptor, SetAdminCookieInterceptor, ClearAdminCookieInterceptor, LogRing, JsonLogger, ...portTokens],
})
export class InfrastructureModule {}
