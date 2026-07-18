// Flat config, intentionally close to defaults — don't bikeshed.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', 'supabase/.temp/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Hard rule for this repo: no `any`.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
