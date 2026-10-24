export default {
  test: {
    globals: true,
    globalSetup: ['test/security/global-setup.ts'],
    include: ['test/security/admin-audit-alerts.integration.spec.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 90_000,
    env: {
      PRIZE_DEV_DEFAULT_COUNTRY: 'KP',
      TEST_DATABASE_URL: 'postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent1_test',
    },
  },
};
