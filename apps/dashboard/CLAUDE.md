# apps/dashboard

Next.js (App Router, `src/`). Phase 1 screens: `/login` (email/password) and
`/inbox` (conversation list + live thread via Supabase Realtime). This is the
structural template for all D-workstreams.

## Do

- Import every type/schema from `@optiax/shared` (e.g. `Database` for
  supabase-js typing).
- Talk to Supabase only through the helpers in `src/lib/supabase/`
  (anon key + user session; RLS does the scoping) — enforced by eslint
  `no-restricted-imports` and the runtime's import-restriction test.
- **Every UI string goes in `src/i18n/es.json`**, accessed via the typed
  `t('screen.key')` helper (`src/i18n/index.ts`). Zero hardcoded copy.
- Guard authenticated routes in `src/middleware.ts` (session refresh lives in
  `src/lib/supabase/middleware.ts`).
- Render config validation errors from `validateAgentConfig`'s structured
  `path`+`message` list (when the configurator arrives).

## Don't

- Don't use the service-role key here, ever (CI greps for it).
- Don't edit raw prompts in the UI — the dashboard edits structured config only.
- Don't add an i18n library yet — revisit in D1.
- Don't add a composer/sending to the inbox yet — later feature.
