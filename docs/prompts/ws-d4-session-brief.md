# Session brief: Workstream D4 — Home dashboard + Settings masters

*(Run only after `feat/ws-d3-configurator` is merged to `main`. Paste everything below into Claude Code at the repo root. This is the last Phase 2 workstream.)*

---

You are building **workstream D4** of the Optiax WhatsApp CRM: the Home snapshot (PRD Screen 0) and the Settings masters (PRD Screen 7) — the management UIs for the `attribute_defs`, `order_statuses`, and `payment_methods` that other screens have read from seed data until now. Dashboard work + two small migrations. After this, the core CRM + agent is feature-complete.

## Read first, in this order
1. `docs/specs/ws-d4-home-settings.md` — your spec. §0 carry-ins first.
2. Ratified decisions: phase-0 §11, phase-1 §9, R1 §8, D2 §7, R2 §8, R3 §6, **D3 §9**. Do not "fix" any of them.
3. D1's app-shell/table/query/CSV patterns and D2's masters usage + role canaries — copy those patterns.

## Setup
- Branch `feat/ws-d4-home-settings` off `main`. **Do not self-merge to `main`** — Juan owns the merge; if `main` lacks a prerequisite, stop and say so.
- `supabase start && supabase db reset && pnpm seed:auth` (Kong quirk → `docker restart supabase_kong_optiax-crm`).

## Deliverables (detailed in the spec)
1. §0 carry-ins: `orders.verified_by` migration + wire D2's verify button; in-app nav guard for `/agent`; optional `agent_turns.prompt_version_id` nullable (decide per Home's needs).
2. Home `/home`: Ventas de hoy, Pedidos pendientes, Acción necesaria, Campañas activas (placeholder) — tenant-tz correct (§1).
3. Settings `/settings` (admin-only): attribute_defs, order_statuses (rename/reorder over fixed kinds), payment_methods, team role management (no invites), links for import + WhatsApp-channel placeholder (§2).
4. Thread `tenants.timezone` through dashboard date helpers (§3).
5. Tests per §4; demo + `SESSION_NOTES.md` (incl. the Phase-2-complete summary) per §5.

## Hard rules
- Anon key + RLS only in the dashboard; masters are admin-write per the phase-0 role matrix — verify with the seeded rep (canary tests).
- Migrations append-only: §0/§3 add columns only (no new tables); isolation + meta + eval suites stay green; grants explicit.
- `attribute_defs.key` is immutable once created (it's referenced in configs + `customers.attributes`); disabling/deleting an in-use def warns first.
- `order_statuses`: rename/reorder only — never add/remove `kind`s (pipeline logic depends on them).
- Types/schemas from `packages/shared`; no `any`; every UI string in `es.json`. No new deps.
- Don't rebuild D1's CSV import; don't build WhatsApp token entry or user invites (Phase 4).
- Ratified decision seems wrong → log it, don't change it.

## Definition of done
Spec §5 checklist, all boxes. Verify at least one Home KPI by hand against seed data. End with `SESSION_NOTES.md`: numbered assumptions, demo script, questions, and a short **"Phase 2 complete"** note mapping the 8 PRD screens to live-vs-deferred.
