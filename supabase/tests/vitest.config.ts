import { defineConfig } from 'vitest/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    dir: dirname(fileURLToPath(import.meta.url)),
    include: ['**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // DB tests share seeded state; run files serially to keep them independent-ish.
    fileParallelism: false,
  },
});
