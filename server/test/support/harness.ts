import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { configureApp } from '../../src/app/configure-app.js';
import { AppModule } from '../../src/app/app.module.js';
import { StaleRideScheduler } from '../../src/infrastructure/scheduling/stale-ride.scheduler.js';
import { AchievementRepositoryPort } from '../../src/application/ports/achievements/achievement.repository.port.js';
import { ChallengeRepositoryPort } from '../../src/application/ports/auth/challenge.repository.port.js';
import { ChainPort } from '../../src/application/ports/economy/chain.port.js';
import { PoolChainPort } from '../../src/application/ports/economy/pool-chain.port.js';
import { ChainCursorRepositoryPort, ChainEventRepositoryPort } from '../../src/application/ports/economy/chain-event.repository.port.js';
import { PaymentRepositoryPort } from '../../src/application/ports/economy/payment.repository.port.js';
import { RoundRepositoryPort } from '../../src/application/ports/economy/round.repository.port.js';
import { HealthProbePort } from '../../src/application/ports/health/health-probe.port.js';
import { PlayerRepositoryPort } from '../../src/application/ports/players/player.repository.port.js';
import { RideQueryPort } from '../../src/application/ports/rides/ride-query.port.js';
import { RideRepositoryPort } from '../../src/application/ports/rides/ride.repository.port.js';
import { ClockPort } from '../../src/application/ports/shared/clock.port.js';
import { EntropyPort } from '../../src/application/ports/shared/entropy.port.js';
import { NodeEntropy } from '../../src/infrastructure/crypto/node.entropy.js';
import { START_HOURS, worldFor } from '../../src/domain/rides/ride-rules.js';
import { TransactionPort } from '../../src/application/ports/shared/transaction.port.js';
import { RideBatchRepositoryPort } from '../../src/application/ports/telemetry/ride-batch.repository.port.js';
import { RideVerdictRepositoryPort } from '../../src/application/ports/verdict/ride-verdict.repository.port.js';
import { SignInRepositoryPort } from '../../src/application/ports/auth/sign-in.repository.port.js';
import { AdminActionRepositoryPort } from '../../src/application/ports/admin/admin-action.repository.port.js';
import { MemoryAdminDirectory } from './in-memory/memory-admin-directory.js';
import { AdminDirectoryPort } from '../../src/application/ports/admin/admin-directory.port.js';
import { AdminQueryPort } from '../../src/application/ports/admin/admin-query.port.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { truncateAllTables } from '../../src/infrastructure/prisma/truncate.js';
import { FakeChain, TREASURY } from './fake-chain.js';
import { FakePoolChain } from './fake-pool-chain.js';
import { FakeClock } from './fake-clock.js';
import { MemoryDb } from './in-memory/memory-db.js';
import { MemorySettingsRepository } from './in-memory/memory-settings.js';
import { DailySeedRepositoryPort } from '../../src/application/ports/rides/daily-seed.repository.port.js';
import { MemoryDailySeedRepository } from './in-memory/memory-daily-seeds.js';
import { SettingsRepositoryPort } from '../../src/application/ports/settings/settings.repository.port.js';
import {
  MemoryAchievementRepository, MemoryChallengeRepository, MemoryHealthProbe, MemoryPaymentRepository, MemoryPlayerRepository,
  MemoryRideBatchRepository, MemoryRideQuery, MemoryRideVerdictRepository, MemorySignInRepository, MemoryAdminActionRepository, MemoryAdminQuery, MemoryRideRepository, MemoryRoundRepository, MemoryTransaction,
} from './in-memory/memory-repositories.js';
import { MemoryCosmeticRepository, MemoryPoolRepository, MemoryPromoRepository, MemoryRideTicketRepository, MemoryTicketOrderRepository } from './in-memory/memory-ledger-repositories.js';
import { TicketOrderRepositoryPort } from '../../src/application/ports/economy/ticket-order.repository.port.js';
import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';
import { CosmeticRepositoryPort } from '../../src/application/ports/players/cosmetic.repository.port.js';
import { PromoRepositoryPort } from '../../src/application/ports/economy/promo.repository.port.js';
import { RideTicketRepositoryPort } from '../../src/application/ports/players/ride-ticket.repository.port.js';
import { MemoryChainCursorRepository, MemoryChainEventRepository } from './in-memory/memory-repositories.js';
import { CachePort } from '../../src/application/ports/shared/cache.port.js';
import { MemoryCacheAdapter } from '../../src/infrastructure/cache/memory-cache.adapter.js';
import { MemoryStatsRepository } from './in-memory/memory-stats-repository.js';
import { StatsRepositoryPort } from '../../src/application/ports/stats/stats.repository.port.js';
import { MemoryDonationOrderRepository, MemoryRideEventRepository, MemoryRideMuteRepository } from './in-memory/memory-live-repositories.js';
import { DonationOrderRepositoryPort } from '../../src/application/ports/live/donation-order.repository.port.js';
import { RideMuteRepositoryPort } from '../../src/application/ports/live/ride-mute.repository.port.js';
import { RideEventRepositoryPort } from '../../src/application/ports/live/ride-event.repository.port.js';

/** the real entropy, except that a test can fix the NEXT ride seed (a seed decides the route and the start hour) */
class TestEntropy extends NodeEntropy {
  next: number | null = null;
  override seed31(): number { if (this.next === null) return super.seed31(); const s = this.next; this.next = null; return s; }
}

export type Persistence = 'memory' | 'postgres';

/** The integration suite's OWN database (same container as dev, different database): it is wiped before every test, so it must never be the developer's. */
export const DEFAULT_TEST_DATABASE_URL = 'postgresql://freight:freight_dev_password@localhost:15433/freightchain_test';
export const testDatabaseUrl = (): string => process.env['TEST_DATABASE_URL'] ?? DEFAULT_TEST_DATABASE_URL;

export interface Harness {
  app: INestApplication;
  clock: FakeClock;
  /** the NEXT ride's seed (and so its route + start hour, ride-rules.ts worldFor) can be chosen: `h.seedFor('siberia')` before ordering a ride */
  seedFor(route: string, hourIndex?: number): void;
  chain: FakeChain;
  /** the pool program (PoolChainPort) */
  poolChain: FakePoolChain;
  persistence: Persistence;
  server(): Server;
  /** wipes every table / map and the fake chain (the clock keeps running forward) */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Everything the app reads from the environment that a test may change – cleared before each harness so files can't leak into each other. */
const TUNABLES = ['THROTTLE_LIMIT', 'THROTTLE_AUTH_LIMIT', 'THROTTLE_PROMO_LIMIT', 'HB_TIMEOUT_MS', 'FREE_RIDE_SECONDS', 'DEMO_WALLETS', 'DEMO_SCALE', 'INITIAL_SEED_SOL', 'HB_MIN_INTERVAL_MS', 'TRUST_PROXY', 'SOL_USD', 'TREASURY_PUBKEY', 'JWT_SECRET', 'CLIENT_DIR', 'COOKIE_DOMAIN', 'CORS_ORIGINS', 'ADMIN_WALLETS', 'ADMIN_JWT_SECRET', 'ADMIN_SESSION_TTL_MINUTES', 'VERDICT_ENFORCE', 'TELEMETRY_RETENTION_DAYS', 'SIGNIN_RETENTION_DAYS', 'CHALLENGE_INTERVAL_SECONDS',
  'CHALLENGE_FREE_RIDES', 'LIVE_CHAT', 'LIVE_DONATIONS', 'LIVE_FREE_DONATIONS', 'LIVE_EFFECTS', 'PAYMENT_MODE', 'TICKET_PROGRAM_ID', 'FEE_TREASURY', 'SEED_TREASURY', 'ORDER_TTL_MINUTES', 'WATCH_INTERVAL_MS', 'WEBHOOK_SECRET', 'CRANK_SECRET', 'CRANK_INTERVAL_MS', 'FEE_PAYER_SECRET', 'SOLANA_COMMITMENT',
  'POSTHOG_KEY', 'POSTHOG_HOST', 'POSTHOG_ENABLED', 'POSTHOG_DISABLED', 'POSTHOG_PROJECT_ID'];

/**
 * Boots the REAL app (every controller, pipe, guard, filter, handler) with a fake clock and a fake chain.
 * 'memory' swaps the repositories for in-memory twins (fast, no Docker); 'postgres' keeps the real Prisma repositories.
 */
export async function createHarness(persistence: Persistence, env: Record<string, string> = {}): Promise<Harness> {
  for (const key of TUNABLES) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: 'test', JWT_SECRET: 'test-secret-'.padEnd(48, 'x'), SOL_USD: '100', TREASURY_PUBKEY: TREASURY, THROTTLE_LIMIT: '1000000', THROTTLE_AUTH_LIMIT: '1000000', THROTTLE_PROMO_LIMIT: '1000000',
    WATCH_INTERVAL_MS: '0', // the program watcher off: scenarios settle through the webhook / their own calls
    DATABASE_URL: persistence === 'postgres' ? testDatabaseUrl() : 'postgresql://unused:unused@127.0.0.1:1/unused_test',   // NEVER the shell's DATABASE_URL
    ...env,
  });
  const entropy = new TestEntropy();
  const clock = new FakeClock();
  const chain = new FakeChain();
  const poolChain = new FakePoolChain();
  const memory = new MemoryDb();

  // the stale-ride sweep runs on a REAL timer – it would race the fake clock; scenarios run SweepStaleRidesCommand themselves
  let builder = Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EntropyPort).useValue(entropy).overrideProvider(StaleRideScheduler).useValue({}).overrideProvider(ClockPort).useValue(clock).overrideProvider(ChainPort).useValue(chain).overrideProvider(PoolChainPort).useValue(poolChain);
  if (persistence === 'memory') {
    builder = builder
      .overrideProvider(PrismaService).useValue({ $connect: async () => undefined, $disconnect: async () => undefined })
      .overrideProvider(PlayerRepositoryPort).useValue(new MemoryPlayerRepository(memory))
      .overrideProvider(ChallengeRepositoryPort).useValue(new MemoryChallengeRepository(memory))
      .overrideProvider(RideRepositoryPort).useValue(new MemoryRideRepository(memory))
      .overrideProvider(DailySeedRepositoryPort).useValue(new MemoryDailySeedRepository(memory))
      .overrideProvider(RideQueryPort).useValue(new MemoryRideQuery(memory))
      .overrideProvider(RoundRepositoryPort).useValue(new MemoryRoundRepository(memory))
      .overrideProvider(PaymentRepositoryPort).useValue(new MemoryPaymentRepository(memory))
      .overrideProvider(AchievementRepositoryPort).useValue(new MemoryAchievementRepository(memory))
      .overrideProvider(PoolRepositoryPort).useValue(new MemoryPoolRepository(memory))
      .overrideProvider(RideTicketRepositoryPort).useValue(new MemoryRideTicketRepository(memory))
      .overrideProvider(PromoRepositoryPort).useValue(new MemoryPromoRepository(memory))
      .overrideProvider(CosmeticRepositoryPort).useValue(new MemoryCosmeticRepository(memory))
      .overrideProvider(TicketOrderRepositoryPort).useValue(new MemoryTicketOrderRepository(memory))
      .overrideProvider(RideBatchRepositoryPort).useValue(new MemoryRideBatchRepository(memory))
      .overrideProvider(RideVerdictRepositoryPort).useValue(new MemoryRideVerdictRepository(memory))
      .overrideProvider(SignInRepositoryPort).useValue(new MemorySignInRepository(memory))
      .overrideProvider(AdminActionRepositoryPort).useValue(new MemoryAdminActionRepository(memory))
      .overrideProvider(AdminQueryPort).useValue(new MemoryAdminQuery(memory))
      .overrideProvider(AdminDirectoryPort).useValue(new MemoryAdminDirectory(memory))
      .overrideProvider(TransactionPort).useValue(new MemoryTransaction())
      .overrideProvider(HealthProbePort).useValue(new MemoryHealthProbe())
      .overrideProvider(ChainEventRepositoryPort).useValue(new MemoryChainEventRepository(memory))
      .overrideProvider(ChainCursorRepositoryPort).useValue(new MemoryChainCursorRepository(memory))
      .overrideProvider(RideEventRepositoryPort).useValue(new MemoryRideEventRepository(memory))
      .overrideProvider(RideMuteRepositoryPort).useValue(new MemoryRideMuteRepository(memory))
      .overrideProvider(DonationOrderRepositoryPort).useValue(new MemoryDonationOrderRepository(memory))
      .overrideProvider(StatsRepositoryPort).useValue(new MemoryStatsRepository(memory))
      .overrideProvider(SettingsRepositoryPort).useValue(new MemorySettingsRepository(memory));
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  const prisma = persistence === 'postgres' ? app.get(PrismaService, { strict: false }) : null;

  return {
    app, clock, chain, poolChain, persistence,
    seedFor: (route, hourIndex = 0) => { let s = 1000; while (worldFor(s).route !== route || worldFor(s).startHour !== START_HOURS[hourIndex]) s++; entropy.next = s; },
    server: () => app.getHttpServer() as Server,
    reset: async () => {
      chain.reset();
      poolChain.reset();
      memory.reset();
      if (prisma) await truncateAllTables(prisma);
      const cache = app.get(CachePort);   // the cached statistics describe the database that was just wiped
      if (cache instanceof MemoryCacheAdapter) cache.clear();
    },
    close: () => app.close(),
  };
}
