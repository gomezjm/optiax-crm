import { defineConfig } from 'vitest/config';

// Needs local Supabase: `supabase start` + `supabase db reset` + `pnpm seed:auth`.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
