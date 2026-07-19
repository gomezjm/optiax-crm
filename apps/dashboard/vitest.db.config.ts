/**
 * DB-backed suite (WS-D1 §8): runs against local Supabase with seeded data —
 * `supabase db reset` + `pnpm seed:auth` first. Wired into root `pnpm db:test`.
 */
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['test/db/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
