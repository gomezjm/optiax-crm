# Workstream D1 — Customers screen (+ dashboard app shell)

First full dashboard screen (PRD Screen 1). Double duty: build the Customers directory AND establish the app shell + UI foundation every later D-session reuses. Dashboard-only — zero runtime changes.

Read first: PRD Screen 1 (root `PRD_ LatAm WhatsApp CRM & AI Agent.md`); Phase 1 dashboard patterns (`apps/dashboard/src/` — auth, `@supabase/ssr` fencing in `src/lib/supabase/`, `es.json` + `t()`); ratified decisions (phase-0 §11, phase-1 §9, R1 §8). Schema: `customers`, `tags`, `customer_tags`, `attribute_defs` in `packages/shared/src/db-types.ts`.

**Not in scope**: segments (C1), campaigns (C2), orders UI (D2), attribute_defs management UI (D4 Settings — D1 only *reads* defs), agent config (D3), inbox changes, team management. No schema changes expected.

## 1. App shell (foundation — get this right)

- Authenticated layout: sidebar nav — Inicio, Bandeja (inbox), Clientes, Pedidos, Productos, Campañas, Agente IA, Configuración. Only Bandeja + Clientes are live; the rest render a small "Próximamente" placeholder page (routes exist, no content). Active-state highlighting, tenant name from `tenants`, user menu with sign-out.
- **shadcn/ui setup** (per architecture doc; copy-in components, not a heavy dep): install the CLI baseline + only the components D1 needs (table, dialog, dropdown-menu, badge, button, input, select, checkbox, sheet/drawer, toast). Later sessions add more the same way.
- i18n: keys namespaced per screen (`nav.*`, `customers.*`, `common.*`) in `es.json`; extend the Phase 1 typed `t()`. Every string, including placeholders and toasts.
- Mobile: don't invest — usable at desktop widths, sidebar collapses to icons if cheap. LatAm owners will get mobile polish later.

## 2. Customers list (`/customers`)

- Columns: name (fallback: phone/wa_id), phone, tags (colored badges), consent badge (`opted_in` green / `opted_out` red / `unknown` gray), total_spent, last_order_at, last_message_at (relative, es locale), source. Automated metrics read-only by definition.
- Search: name/phone/email, debounced, server-side `ilike`.
- Filters (combinable, URL search params so views are shareable/bookmarkable): tags (any-of), consent status, source, attribute values (per enabled `attribute_defs`: select → options dropdown; boolean → toggle; text → contains; number/date → min/max), metric ranges (total_spent min/max, last_order_at older/newer than N days).
- Sort: name, total_spent, last_order_at, last_message_at. Pagination: server-side, 50/page, offset-based (fine at MVP scale; note cursor upgrade path in code comment).
- Row click → detail drawer (§3). Checkbox column → mass edit (§5).
- Empty states: no customers at all (explain auto-creation by the agent) vs no filter results.

## 3. Customer detail (drawer over the list)

- Core fields editable: name, phone, email, address, city, gender, age_group. Consent editable via explicit select (with a hint that opt-out must be honored).
- Attributes section: driven by enabled `attribute_defs` — type-aware inputs (`text`/`number`/`date`/`select` from `options`/`boolean`). Values live in `customers.attributes` jsonb; write only keys that have defs.
- Tags: add/remove from tenant's tags; create-new-tag inline (name + color from a fixed palette).
- Read-only: total_spent, last_order_at, last_message_at, source, created_at.
- Links: **Ver conversación** → `/inbox?conversation=<id>` (look up the customer's conversation; hide if none) and **Abrir en WhatsApp** → `https://wa.me/<wa_id>` external deep link (hide if no `wa_id`).
- Save via optimistic update + toast on error. Zod-validate before write (schema `CustomerEditSchema` — new, lives in `packages/shared`).

## 4. Manual creation

"Nuevo cliente" button → same drawer, empty. Requires at least name + phone. `source: 'manual'` (provenance is explicit — never default it). Duplicate check on phone/wa_id: warn + link to existing instead of creating.

## 5. Mass edit

Select N rows (+ "select all matching filter" up to a 500 cap) → action bar: add tags, remove tags, set one attribute value, set consent. Batched updates (chunks of 100), progress + result toast (`X actualizados, Y errores`). No mass delete.

## 6. CSV import (`/customers/import`)

- **Papaparse is approved** for this (client-side parse; the one new dependency).
- Flow: upload → header-mapping step (auto-match common Spanish/English headers: nombre/name, teléfono/phone, correo/email, ciudad/city…; map extra columns to enabled attribute defs or "ignorar") → validation preview (first 20 rows rendered; per-row errors listed with row numbers; `CustomerImportRowSchema` in `packages/shared`) → import.
- Rules: cap 5,000 rows/file; phone normalized to digits (strip `+`, spaces, dashes); dedupe against existing (tenant, phone or wa_id) → **skip**, never overwrite; `source: 'import'`; consent defaults `unknown` unless a mapped column provides it. Result screen: imported / skipped-duplicate / failed counts + downloadable CSV of failed rows with reasons.
- Include `fixtures/customers-import-sample.csv` (20 realistic Colombian rows, mixed valid/invalid) for the demo.

## 7. Data access

- Anon-key + RLS only (no service key in the dashboard — the Phase 1 import-restriction pattern extends to any new lib code). `sales_rep` can do everything on this screen except nothing — customers/tags/customer_tags are rep-writable per the Phase 0 matrix; verify against seeded rep user in the demo.
- Reads/writes through a `src/lib/customers/` query module (typed query builders, filter model → PostgREST params) — not inline in components. Filter model is a plain serializable object; unit-test its translation.

## 8. Tests

- Unit: filter-model → query translation (every filter type), `CustomerEditSchema` + `CustomerImportRowSchema` validation, phone normalization, CSV header auto-matching.
- DB-backed (pattern from existing integration suite — sign in as seeded users): import batch function (dedupe-skip proven against seed data), mass-edit batch function, rep-role write success on customers + failure on a master table (regression canary).
- Isolation + meta suites stay green. Dashboard production build passes.

## 9. Definition of done

- [ ] Demo (script in `SESSION_NOTES.md`): login as `rep@modavalentina.test` → browse seeded customers → filter by tag + attribute → edit a customer's attributes → create manual customer → mass-tag 2 rows → import the sample CSV (see skips + errors reported) → deep links work
- [ ] All §8 tests green; `pnpm typecheck && pnpm test && pnpm db:test` green; production build passes
- [ ] Every UI string in `es.json`; no service key; no schema changes (if one proved necessary: new migration + tenant_id + RLS + grants, and flag it)
- [ ] `SESSION_NOTES.md`: numbered assumptions, demo script, questions
