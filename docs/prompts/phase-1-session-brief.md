# Session brief: Phase 1 — Walking skeleton

*(Run only after `feat/phase-0-contracts` is merged to `main`. Paste everything below into Claude Code at the repo root.)*

---

You are building **Phase 1** of the Optiax WhatsApp CRM: one thin end-to-end slice — simulated webhook → queue → tenant resolution → real Gemini reply → persisted messages → live bare-bones inbox. This becomes the reference implementation for every later session, so structure and patterns matter more than features.

## Read first, in this order
1. `docs/specs/phase-1-walking-skeleton.md` — your spec, including explicit non-goals. **§11 of `docs/specs/phase-0-contracts.md` lists ratified decisions you must not "fix".**
2. Root `CLAUDE.md` and the per-package ones.
3. `whatsapp-crm-architecture.md` §4 "Inbound message (hot path)".

## Setup
- Branch `feat/phase-1-walking-skeleton` off `main`.
- `supabase start && supabase db reset && pnpm seed:auth` before DB work; a real `GEMINI_API_KEY` will be provided via `apps/runtime/.env.local` (ask for it when you reach manual testing — automated tests must use `FakeModel` and never call the network).

## Deliverables (detailed in the spec)
1. Runtime: webhook route + pgmq worker with retry/poison handling (§1).
2. **Tenant-scoped repository module** with import-restriction enforcement — the raw service client never leaves `apps/runtime/src/db/` (§1).
3. `AgentModel` interface + `GeminiModel` + `FakeModel` (§2).
4. `WaSender` interface + `MockWaSender` (§3).
5. Dashboard: login + `/inbox` with Realtime, `es.json` i18n pattern, no service key (§4).
6. Env examples (§5), unit + integration tests (§6), demo script + `SESSION_NOTES.md` (§7).

## Hard rules
- Isolation tests stay green; run `pnpm db:test` before declaring done.
- Schema changes only via **new** migration files, and only if truly needed (enabling Realtime on `messages` is the one expected case). Any new table gets `tenant_id` + RLS or the meta-test fails you.
- Types/schemas come from `packages/shared` — never redeclare. Don't modify the compiler or `packages/shared` schemas; if you believe a contract is wrong, stop and log it in `SESSION_NOTES.md` instead.
- No new heavy dependencies beyond Hono, the official Gemini SDK, and Supabase clients. No i18n library yet.
- Every dashboard string in `es.json`. No `any`.
- Scope discipline: no pause-setting logic, no tools, no audio handling, no 24h gating, no configurator, no real WhatsApp sending. Flag checks only, per spec.

## Definition of done
Spec §8 checklist, all boxes. End with `SESSION_NOTES.md`: assumptions, deviations, the demo script, and questions for the coordinator.
