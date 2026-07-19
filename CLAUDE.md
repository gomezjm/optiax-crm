# Optiax CRM — multi-tenant WhatsApp CRM + AI sales agent

## Repo map

| Path | What it is |
|---|---|
| `packages/shared` | **The only home for types/schemas.** Zod schemas (agent config, segment rules, auto-reply triggers), prompt compiler, generated DB types, webhook fixtures + signature stub. |
| `apps/runtime` | Hono service: `POST /webhooks/wa` + pgmq worker + per-message agent loop (Phase 1). DB only via the tenant-scoped repo in `src/db/`. |
| `apps/dashboard` | Next.js App Router: login + `/inbox` (Realtime). i18n via `src/i18n/es.json` + typed `t()`. Anon key only. |
| `supabase/` | Migrations, `seed.sql`, isolation tests (`tests/`), local config. |
| `scripts/` | `seed-auth.ts` (auth users + compiled prompts), `simulate.ts` (webhook fixture POSTer). |
| `docs/specs/` | Phase specs. Phase 0: `phase-0-contracts.md` (authoritative on schema). |

## Commands

```bash
pnpm i && supabase start          # once per machine/session
supabase db reset                 # migrations + seed.sql
pnpm seed:auth                    # auth users, profiles, compiled prompt_versions
pnpm test                         # unit tests (all packages)
pnpm db:test                      # isolation suite (needs the three steps above)
pnpm typecheck                    # builds shared, typechecks all packages
pnpm gen:types                    # regenerate packages/shared/src/db-types.ts
pnpm simulate inbound-text        # POST a webhook fixture at the local runtime
pnpm --filter @optiax/runtime dev    # webhook server + worker (port 8787)
pnpm --filter @optiax/dashboard dev  # dashboard (port 3000)
```

## Conventions (hard rules)

- **Types and schemas live in `packages/shared` and nowhere else.** Apps import; they never redeclare.
- **Migrations are append-only.** Never edit an applied/committed migration — add a new file.
- **No `any`**, no `@ts-ignore` without a comment explaining why. TypeScript strict everywhere.
- UI strings belong in `es.json` (i18n files), not hardcoded in components (applies from Phase 1).
- No ORM: supabase-js + SQL migrations only. No heavy deps without discussion.
- Prompt templates: any change to `packages/shared/src/compiler/` requires bumping `COMPILER_VERSION`.
- Service role key: the runtime accesses the DB **only** through a tenant-scoped repository module; the raw service client is never exported (Phase 1 enforces in code; the rule stands now).

## The standing rule

**Isolation tests must pass before any commit is considered done.**
`pnpm db:test` green against seeded data — no exceptions. The meta-test fails CI if any
new `public` table lacks RLS or a `tenant_id` column.
