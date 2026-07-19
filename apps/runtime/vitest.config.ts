import { defineConfig } from 'vitest/config';

// Unit tests only — no DB. Integration tests (local Supabase) run separately
// via `pnpm db:test` at the repo root (vitest.integration.config.ts).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
  },
});
