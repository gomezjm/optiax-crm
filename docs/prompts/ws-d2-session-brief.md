# Session brief: Workstream D2 — Orders + Products screens

*(Run only after `feat/ws-d1-customers` is merged to `main`. Paste everything below into Claude Code at the repo root.)*

---

You are building **workstream D2** of the Optiax WhatsApp CRM dashboard: the Products catalog (PRD Screen 6) and Orders management (PRD Screen 4), plus three small carry-overs ratified from D1. Dashboard work + exactly one migration (a denormalization trigger). Do not touch the runtime.

## Read first, in this order
1. `docs/specs/ws-d2-orders-products.md` — your spec; §0 carry-overs come first.
2. Ratified decisions: phase-0 §11, phase-1 §9, R1 §8, **D1 §10** (English routes, digit phones, shadcn scope, no hosted fonts). Do not "fix" any of them.
3. D1's code: `apps/dashboard/src/lib/customers/` + its components/tests — **copy that architecture**; don't invent a second pattern.

## Setup
- Branch `feat/ws-d2-orders-products` off `main`.
- `supabase start && supabase db reset && pnpm seed:auth` (if `seed:auth` returns `{}`, `docker restart supabase_kong_optiax-crm` — known quirk).

## Deliverables (detailed in the spec)
1. §0 carry-overs: English route renames; phone normalization in manual entry; seeded boolean/number attribute defs + filter proof tests.
2. Products: list/filters, create-edit drawer, 2-image Storage upload with client-side downscale, availability quick-toggle, guarded delete (§1).
3. Orders: list/filters/payment-state chips, detail drawer (status, payment incl. proof + verify, logistics), manual creation, "Entregas de hoy" CSV export (§2, §3).
4. Migration: `total_spent`/`last_order_at` recompute trigger on `orders`, excluding `cancelled` (§4).
5. New Zod schemas in `packages/shared`: `ProductSchema`, `ProductCategorySchema`, `OrderCreateSchema`, `OrderUpdateSchema` (R2 will reuse them).
6. Tests per §5; demo script + `SESSION_NOTES.md` per §6.

## Hard rules
- Anon key + RLS only in the dashboard; supabase-js imports stay fenced.
- The §4 trigger is the **only** DB change: new migration file, never edit applied ones; isolation + meta suites must stay green.
- Schemas in `packages/shared` only; no `any`; every UI string in `es.json`.
- No new dependencies (Papaparse + shadcn components already approved; image downscale via canvas, not a library). No hosted fonts.
- Storage uploads only under `{tenant_id}/…` prefixes via the anon-key client.
- Scope discipline: no OCR, no agent capture, no statuses/payment-methods management UI, no PDF export, no transition-rule engine.
- If a ratified decision seems wrong, log it in `SESSION_NOTES.md` — don't change it.

## Definition of done
Spec §6 checklist, all boxes. End with `SESSION_NOTES.md`: numbered assumptions, demo script, questions for the coordinator.
