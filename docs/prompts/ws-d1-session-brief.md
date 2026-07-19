# Session brief: Workstream D1 — Customers screen + app shell

*(Run only after `feat/ws-r1-coexistence` is merged to `main`. Paste everything below into Claude Code at the repo root.)*

---

You are building **workstream D1** of the Optiax WhatsApp CRM dashboard: the Customers directory (PRD Screen 1) plus the app shell (sidebar nav, shadcn/ui foundation) that every later dashboard session will reuse. Dashboard-only — do not touch the runtime.

## Read first, in this order
1. `docs/specs/ws-d1-customers.md` — your spec, including non-goals.
2. Ratified decisions: `docs/specs/phase-0-contracts.md` §11, `docs/specs/phase-1-walking-skeleton.md` §9, `docs/specs/ws-r1-coexistence-window.md` §8. Do not "fix" any of them.
3. Existing dashboard code (`apps/dashboard/src/`) — extend its auth/i18n/supabase patterns; don't reinvent them.
4. PRD Screen 1 + `docs/session-notes/` for conventions.

## Setup
- Branch `feat/ws-d1-customers` off `main`.
- `supabase start && supabase db reset && pnpm seed:auth`. Dashboard env per `apps/dashboard/.env.example`.

## Deliverables (detailed in the spec)
1. App shell: sidebar nav (live: Bandeja, Clientes; rest "Próximamente"), shadcn/ui baseline (§1).
2. Customers list: columns, search, combinable URL-param filters, sort, pagination (§2).
3. Detail drawer: core fields, attribute-def-driven inputs, tags, consent, deep links (§3).
4. Manual creation with duplicate warning (§4). Mass edit with 500 cap (§5).
5. CSV import wizard with mapping, validation preview, dedupe-skip, sample fixture (§6).
6. `CustomerEditSchema` + `CustomerImportRowSchema` in `packages/shared`; typed query module in `src/lib/customers/` (§7).
7. Tests per §8; demo script + `SESSION_NOTES.md` per §9.

## Hard rules
- Anon key + RLS only. The service key never appears in the dashboard; supabase-js imports stay fenced per the Phase 1 pattern.
- Every UI string in `es.json` (Spanish). New Zod schemas go in `packages/shared`; nothing redeclared locally; no `any`.
- Dependencies: shadcn/ui components (copy-in) + Papaparse are pre-approved. Anything else: don't — log the wish in `SESSION_NOTES.md`.
- No schema changes expected. If one is truly unavoidable: new migration + `tenant_id` + RLS + explicit grants, isolation/meta suites green, and flag it prominently.
- `pnpm db:test` green before declaring done (regression guard — you're not changing the DB, prove it).
- Scope discipline: no segments, no orders UI, no attribute-defs management, no inbox changes beyond the `?conversation=` link target working.
- `customers.source` is never defaulted — every write states provenance (`manual` / `import`).

## Definition of done
Spec §9 checklist, all boxes. End with `SESSION_NOTES.md`: numbered assumptions, demo script, questions for the coordinator.
