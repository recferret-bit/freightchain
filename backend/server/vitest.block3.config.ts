import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The block3 folder has no vitest install. tests/e2e/node_modules would shadow this package.
const dir = fileURLToPath(new URL('../../tests/e2e/block3-anticheat/', import.meta.url));

export default defineConfig({
  test: { dir, include: ['**/*.e2e.spec.ts'], testTimeout: 60_000 },
});
