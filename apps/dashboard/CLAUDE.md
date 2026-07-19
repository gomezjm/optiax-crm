# apps/dashboard

Next.js (App Router, `src/`). Screens: `/login`, `/inbox` (Realtime thread),
`/customers` (+ `/customers/import`) — all authenticated screens live in the
`src/app/(app)/` route group, which provides the sidebar shell. Placeholder
routes exist for the remaining nav items.

UI foundation (since D1): Tailwind v4 + shadcn/ui (`components.json`, copied
components in `src/components/ui/`, `@/*` import alias). Add components with
`pnpm dlx shadcn@latest add <name>`; copied components are our code — fix them
to satisfy the strict tsconfig rather than loosening it. Toasts via sonner
(`toast(...)`; `<Toaster/>` mounts in the app-shell layout).

## Do

- Import every type/schema from `@optiax/shared` (e.g. `Database` for
  supabase-js typing).
- Talk to Supabase only through the helpers in `src/lib/supabase/`
  (anon key + user session; RLS does the scoping) — enforced by eslint
  `no-restricted-imports` and the runtime's import-restriction test.
- **Every UI string goes in `src/i18n/es.json`**, accessed via the typed
  `t('screen.key')` helper (`src/i18n/index.ts`). Zero hardcoded copy.
- Guard authenticated routes in `src/middleware.ts` (session refresh lives in
  `src/lib/supabase/middleware.ts`); new routes must be added to its matcher.
- Data access for a screen goes through a typed query module under `src/lib/`
  (see `src/lib/customers/` — filter model, pure query-plan translation,
  mutations), never inline in components. Unit tests in `test/unit/`,
  DB-backed tests (seeded local stack, part of root `pnpm db:test`) in
  `test/db/`.
- Render config validation errors from `validateAgentConfig`'s structured
  `path`+`message` list (when the configurator arrives).

## Don't

- Don't use the service-role key here, ever (CI greps for it).
- Don't edit raw prompts in the UI — the dashboard edits structured config only.
- Don't add an i18n library — D1 kept the typed `t()` + `es.json` pattern.
- Don't add a composer/sending to the inbox yet — later feature.
- Don't import `@optiax/shared`'s webhook-signature in client components — it
  needs `node:crypto` and is stubbed out of browser bundles via the shared
  package's `browser` field.
