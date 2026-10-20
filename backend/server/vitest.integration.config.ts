import { defineConfig } from 'vitest/config';

/** `npm run test:integration`: the SAME flow scenarios on the real Prisma repositories + a real PostgreSQL (docker compose up -d --wait postgres; prisma migrate deploy),
    plus the concurrency tests that only a real database can answer. Runs files one at a time: they share one database. */
export default defineConfig({
  test: {
    globals: true,
    root: './',
    globalSetup: ['test/integration/global-setup.ts'], // creates the *_test database if missing and migrates it
    include: ['test/integration/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    // Same reason as vitest.config.ts: a missing edge country must not become US and spend the weekly grant.
    env: { PRIZE_DEV_DEFAULT_COUNTRY: 'KP' },
  },
});
