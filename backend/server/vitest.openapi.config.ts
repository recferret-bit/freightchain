import { defineConfig } from 'vitest/config';

/** `npm run openapi:generate` loads scripts/generate-openapi.ts, which writes openapi.json when OPENAPI_WRITE=1. */
export default defineConfig({
  test: {
    include: ['scripts/generate-openapi.ts'],
    passWithNoTests: true,
    fileParallelism: false,
  },
});
