// Flat config, intentionally close to defaults — don't bikeshed.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      'supabase/.temp/**',
      '**/next-env.d.ts', // Next-generated
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Hard rule for this repo: no `any`.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Runtime: the service-role client lives ONLY in src/db (tenant-scoped
    // repository module). Mirrored by the import-restriction unit test.
    files: ['apps/runtime/src/**/*.ts'],
    ignores: ['apps/runtime/src/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message: 'DB access only through src/db (tenant-scoped repository module).',
            },
          ],
          patterns: [
            {
              group: ['**/db/client', '**/db/client.js'],
              message: 'The raw service client is module-private to src/db.',
            },
          ],
        },
      ],
    },
  },
  {
    // Dashboard: Supabase only via src/lib/supabase (anon key + user session).
    files: ['apps/dashboard/src/**/*.{ts,tsx}'],
    ignores: ['apps/dashboard/src/lib/supabase/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message: 'Use the helpers in src/lib/supabase (anon key + session only).',
            },
            {
              name: '@supabase/ssr',
              message: 'Use the helpers in src/lib/supabase (anon key + session only).',
            },
          ],
        },
      ],
    },
  },
);
