# Session brief: Phase 0 — Contracts

*(Paste everything below this line into Claude Code, opened at the repo root.)*

---

You are building **Phase 0** of a multi-tenant WhatsApp CRM + AI sales agent SaaS. This phase produces the contracts every later session depends on: monorepo scaffold, full database schema + RLS, multi-tenant isolation tests, the agent-config Zod schema, the prompt compiler, 360dialog webhook fixtures, and seed data. **No product features, no UI screens, no agent loop** — those come later and depend on getting this exactly right.

## Read first, in this order
1. `docs/specs/phase-0-contracts.md` — your spec. Follow it precisely; it defines every table, schema, and test.
2. `whatsapp-crm-architecture.md` — system context.
3. `PRD_ LatAm WhatsApp CRM & AI Agent.md` — product context (informs naming/fields; do not build its screens).

## Setup
- Initialize git if needed. Work on branch `feat/phase-0-contracts`.
- pnpm workspaces per the spec's repo layout. Supabase CLI for local DB (`supabase init`, `supabase start`).
- Node 20+, TypeScript strict, vitest.

## Deliverables (all defined in detail in the spec)
1. Monorepo scaffold + CI (typecheck, unit tests, DB tests).
2. Supabase migrations: full schema (§2), pgmq queue, storage bucket + policies.
3. RLS per §3, including the `private.tenant_id()` helper pattern.
4. **Isolation test suite** per §9 — including the meta-test that fails CI if any public table lacks RLS or `tenant_id`.
5. `packages/shared`: `AgentConfigSchema`, `SegmentRulesSchema`, `AutoReplyTriggerSchema`, generated DB types, `COMPILER_VERSION`.
6. Prompt compiler per §6 with snapshot + determinism tests (include an adversarial prompt-injection fixture).
7. Webhook fixtures + `pnpm simulate` script per §7.
8. Seed: 2 realistic Colombian small-business tenants per §8, isolation tests green against seeded data.
9. Root + per-package `CLAUDE.md` per §8.
10. `SESSION_NOTES.md` on the branch: assumptions made, spec ambiguities found, anything skipped and why.

## Hard rules
- Migrations are append-only from the moment they're committed — never rewrite one to fix it; add a new one.
- Every type/schema lives in `packages/shared` and nowhere else. Apps import; they never redeclare.
- No `any`, no `@ts-ignore` without a comment explaining why.
- Do not install heavy dependencies not implied by the spec. No ORM — supabase-js and SQL migrations only.
- Do not create a hosted Supabase project, call the real Gemini API, or contact 360dialog. Everything is local + fixtures.
- If the spec is ambiguous, make the smallest reasonable choice and log it in `SESSION_NOTES.md` — do not expand scope.

## Definition of done
Fresh clone → `pnpm i && supabase start && supabase db reset && pnpm test && pnpm db:test` all green, plus the checklist at the end of the spec (§10). Commit in reviewable chunks with clear messages (scaffold / schema / RLS / tests / shared / compiler / fixtures / seed).
