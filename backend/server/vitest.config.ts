import { defineConfig } from 'vitest/config';

/** `npm test`: unit specs, architecture audits, the route manifest, migration checks and the HTTP flow suite on in-memory repositories – no Docker needed. */
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/unit/**/*.spec.ts', 'test/architecture/**/*.spec.ts', 'test/contract/**/*.spec.ts', 'test/migrations/**/*.spec.ts', 'test/http/**/*.spec.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    // lane1:PRIZE_DEV_DEFAULT_COUNTRY — schema default is US, which would make every 18+ wallet prize-eligible in this suite and spend a weekly grant instead of ordering a paid ride. KP stays sanctioned, so a missing edge country does not change those cases. A spec that wants the US fallback passes its own EnvService.
    env: { PRIZE_DEV_DEFAULT_COUNTRY: 'KP' },
  },
});
