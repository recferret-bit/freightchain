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
import { TransactionPort } from '../application/ports/shared/transaction.port.js';
import { JoseTokenSigner } from './auth/jose.token-signer.js';
import { NaclSignatureVerifier } from './auth/nacl.signature-verifier.js';
import { EnvRulesConfigAdapter } from './config/rules-config.adapter.js';
import { NodeEntropy } from './crypto/node.entropy.js';
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

/** Every port the application layer declares is bound to its adapter here – the only place that knows which implementation runs. */
const ports: Provider[] = [
  { provide: ClockPort, useClass: SystemClock },
  { provide: EntropyPort, useClass: NodeEntropy },
  { provide: TransactionPort, useClass: TransactionPrismaAdapter },
  { provide: RulesConfigPort, useClass: EnvRulesConfigAdapter },
  { provide: PlayerRepositoryPort, useClass: PlayerPrismaRepository },
  { provide: ChallengeRepositoryPort, useClass: ChallengePrismaRepository },
  { provide: SignatureVerifierPort, useClass: NaclSignatureVerifier },
  { provide: TokenSignerPort, useClass: JoseTokenSigner },
  { provide: RideRepositoryPort, useClass: RidePrismaRepository },
  { provide: RideQueryPort, useClass: RideQueryPrismaRepository },
  { provide: RoundRepositoryPort, useClass: RoundPrismaRepository },
  { provide: PaymentRepositoryPort, useClass: PaymentPrismaRepository },
  { provide: AchievementRepositoryPort, useClass: AchievementPrismaRepository },
  { provide: PriceQuotePort, useClass: HttpPriceQuoteAdapter },
  { provide: ChainPort, useClass: SolanaChainAdapter },
  { provide: HealthProbePort, useClass: PrismaHealthProbe },
  { provide: PoolChainPort, useClass: ProgramChainAdapter },
  { provide: ChainEventRepositoryPort, useClass: ChainEventPrismaRepository },
  { provide: ChainCursorRepositoryPort, useClass: ChainCursorPrismaRepository },
  { provide: SponsoredTxRepositoryPort, useClass: SponsoredTxPrismaRepository },
];

const portTokens = ports.map((p) => (p as { provide: unknown }).provide as typeof ClockPort);

@Module({
  providers: [PrismaService, PlayerAuthGuard, SetSessionCookieInterceptor, ClearSessionCookieInterceptor, ...ports],
  exports: [PrismaService, PlayerAuthGuard, SetSessionCookieInterceptor, ClearSessionCookieInterceptor, ...portTokens],
})
export class InfrastructureModule {}
