import { defineConfig } from 'vitest/config';

/** `npm test`: unit specs, architecture audits, migration checks and the HTTP flow suite on in-memory repositories – no Docker needed. */
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/unit/**/*.spec.ts', 'test/architecture/**/*.spec.ts', 'test/migrations/**/*.spec.ts', 'test/http/**/*.spec.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
