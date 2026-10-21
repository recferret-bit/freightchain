export default {
  test: {
    globals: true,
    include: ['test/security/admin-surface-matrix.spec.ts', 'test/security/admin-findings-regression.spec.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 90_000,
    env: { PRIZE_DEV_DEFAULT_COUNTRY: 'KP' },
  },
};
