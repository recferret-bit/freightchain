import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { configureApp } from '../../src/app/configure-app.js';
import { AppModule } from '../../src/app/app.module.js';
import { AchievementRepositoryPort } from '../../src/application/ports/achievements/achievement.repository.port.js';
import { ChallengeRepositoryPort } from '../../src/application/ports/auth/challenge.repository.port.js';
import { ChainPort } from '../../src/application/ports/economy/chain.port.js';
import { PaymentRepositoryPort } from '../../src/application/ports/economy/payment.repository.port.js';
import { RoundRepositoryPort } from '../../src/application/ports/economy/round.repository.port.js';
import { HealthProbePort } from '../../src/application/ports/health/health-probe.port.js';
import { PlayerRepositoryPort } from '../../src/application/ports/players/player.repository.port.js';
import { RideQueryPort } from '../../src/application/ports/rides/ride-query.port.js';
import { RideRepositoryPort } from '../../src/application/ports/rides/ride.repository.port.js';
import { ClockPort } from '../../src/application/ports/shared/clock.port.js';
import { TransactionPort } from '../../src/application/ports/shared/transaction.port.js';
import { RideBatchRepositoryPort } from '../../src/application/ports/telemetry/ride-batch.repository.port.js';
import { RideVerdictRepositoryPort } from '../../src/application/ports/verdict/ride-verdict.repository.port.js';
import { SignInRepositoryPort } from '../../src/application/ports/auth/sign-in.repository.port.js';
import { AdminActionRepositoryPort } from '../../src/application/ports/admin/admin-action.repository.port.js';
import { AdminQueryPort } from '../../src/application/ports/admin/admin-query.port.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { truncateAllTables } from '../../src/infrastructure/prisma/truncate.js';
import { FakeChain, TREASURY } from './fake-chain.js';
import { FakeClock } from './fake-clock.js';
import { MemoryDb } from './in-memory/memory-db.js';
import {
  MemoryAchievementRepository, MemoryChallengeRepository, MemoryHealthProbe, MemoryPaymentRepository, MemoryPlayerRepository,
  MemoryRideBatchRepository, MemoryRideQuery, MemoryRideVerdictRepository, MemorySignInRepository, MemoryAdminActionRepository, MemoryAdminQuery, MemoryRideRepository, MemoryRoundRepository, MemoryTransaction,
} from './in-memory/memory-repositories.js';

export type Persistence = 'memory' | 'postgres';

/** The integration suite's OWN database (same container as dev, different database): it is wiped before every test, so it must never be the developer's. */
export const DEFAULT_TEST_DATABASE_URL = 'postgresql://freight:freight_dev_password@localhost:15433/freightchain_test';
export const testDatabaseUrl = (): string => process.env['TEST_DATABASE_URL'] ?? DEFAULT_TEST_DATABASE_URL;

export interface Harness {
  app: INestApplication;
  clock: FakeClock;
  chain: FakeChain;
  persistence: Persistence;
  server(): Server;
  /** wipes every table / map and the fake chain (the clock keeps running forward) */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Everything the app reads from the environment that a test may change – cleared before each harness so files can't leak into each other. */
const TUNABLES = ['THROTTLE_LIMIT', 'THROTTLE_AUTH_LIMIT', 'FREE_RIDE_SECONDS', 'DEMO_WALLETS', 'DEMO_SCALE', 'INITIAL_SEED_SOL', 'HB_MIN_INTERVAL_MS', 'TRUST_PROXY', 'SOL_USD', 'TREASURY_PUBKEY', 'JWT_SECRET', 'CLIENT_DIR', 'COOKIE_DOMAIN', 'CORS_ORIGINS', 'ADMIN_WALLETS', 'ADMIN_JWT_SECRET', 'ADMIN_SESSION_TTL_MINUTES', 'VERDICT_ENFORCE', 'TELEMETRY_RETENTION_DAYS'];

/**
 * Boots the REAL app (every controller, pipe, guard, filter, handler) with a fake clock and a fake chain.
 * 'memory' swaps the repositories for in-memory twins (fast, no Docker); 'postgres' keeps the real Prisma repositories.
 */
export async function createHarness(persistence: Persistence, env: Record<string, string> = {}): Promise<Harness> {
  for (const key of TUNABLES) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: 'test', JWT_SECRET: 'test-secret-'.padEnd(48, 'x'), SOL_USD: '100', TREASURY_PUBKEY: TREASURY, THROTTLE_LIMIT: '1000000', THROTTLE_AUTH_LIMIT: '1000000',
    DATABASE_URL: persistence === 'postgres' ? testDatabaseUrl() : 'postgresql://unused:unused@127.0.0.1:1/unused_test',   // NEVER the shell's DATABASE_URL
    ...env,
  });
  const clock = new FakeClock();
  const chain = new FakeChain();
  const memory = new MemoryDb();

  let builder = Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ClockPort).useValue(clock).overrideProvider(ChainPort).useValue(chain);
  if (persistence === 'memory') {
    builder = builder
      .overrideProvider(PrismaService).useValue({ $connect: async () => undefined, $disconnect: async () => undefined })
      .overrideProvider(PlayerRepositoryPort).useValue(new MemoryPlayerRepository(memory))
      .overrideProvider(ChallengeRepositoryPort).useValue(new MemoryChallengeRepository(memory))
      .overrideProvider(RideRepositoryPort).useValue(new MemoryRideRepository(memory))
      .overrideProvider(RideQueryPort).useValue(new MemoryRideQuery(memory))
      .overrideProvider(RoundRepositoryPort).useValue(new MemoryRoundRepository(memory))
      .overrideProvider(PaymentRepositoryPort).useValue(new MemoryPaymentRepository(memory))
      .overrideProvider(AchievementRepositoryPort).useValue(new MemoryAchievementRepository(memory))
      .overrideProvider(RideBatchRepositoryPort).useValue(new MemoryRideBatchRepository(memory))
      .overrideProvider(RideVerdictRepositoryPort).useValue(new MemoryRideVerdictRepository(memory))
      .overrideProvider(SignInRepositoryPort).useValue(new MemorySignInRepository(memory))
      .overrideProvider(AdminActionRepositoryPort).useValue(new MemoryAdminActionRepository(memory))
      .overrideProvider(AdminQueryPort).useValue(new MemoryAdminQuery(memory))
      .overrideProvider(TransactionPort).useValue(new MemoryTransaction())
      .overrideProvider(HealthProbePort).useValue(new MemoryHealthProbe());
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  const prisma = persistence === 'postgres' ? app.get(PrismaService, { strict: false }) : null;

  return {
    app, clock, chain, persistence,
    server: () => app.getHttpServer() as Server,
    reset: async () => {
      chain.reset();
      memory.reset();
      if (prisma) await truncateAllTables(prisma);
    },
    close: () => app.close(),
  };
}
