# Workstream D4 — Home dashboard + Settings masters

The **last Phase 2 session**. Completes the owner-facing admin surface: the Home snapshot (PRD Screen 0) and the Settings masters (PRD Screen 7) that the configurator and orders screens have been reading from seed data until now. After this, the core CRM + agent is feature-complete and demoable end to end.

Read first: PRD Screens 0 + 7; D1's app-shell/table/query patterns and D2's masters usage (`order_statuses`, `payment_methods`, `attribute_defs` are read by orders/configurator — now they get management UIs); ratified decisions phase-0 §11 … **D3 §9**. Schema already exists for everything except the two small additions in §0.

**Not in scope**: WhatsApp/360dialog channel setup (Phase 4 — Embedded Signup); user *invites* (Phase 4 — needs the auth admin API + email; D4 only manages roles of existing tenant users); campaigns (the Home "Active Campaigns" card is a placeholder until Phase 3); CSV customer import (D1 already built it — Settings links to it).

## 0. Carry-ins (ratified — do first, each its own commit)

1. **`orders.verified_by`** (D2-B): additive migration, `uuid references profiles(id)` nullable. Wire D2's existing "Marcar pago verificado" button to set it to the acting user; the order drawer shows "verificado por {name} · {timestamp}". Isolation/meta/grants stay green.
2. **In-app nav guard for `/agent`** (D3-D): intercept in-app navigation (sidebar clicks) when the configurator has unsaved changes, with a confirm dialog — `beforeunload` alone misses client-side route changes. Keep it scoped/reusable so other big-form screens can adopt it.
3. **Optional — `agent_turns.prompt_version_id` nullable** (R1-4 / D2 revisit): only if the Home "Acción necesaria" health signal (below) wants to surface misconfigured tenants (no active prompt) as observable turns. If you do it: additive migration + `CHECK (prompt_version_id IS NOT NULL OR error IS NOT NULL)`, and the runtime's console-only skip paths become real skip turns. If Home doesn't need it, skip and log that. Decide and note.

## 1. Home dashboard (`/home`) — PRD Screen 0

Motivational daily snapshot, all tenant-scoped, all in the tenant's timezone (see §3). KPI cards:

- **Ventas de hoy**: sum of `orders.total` for orders created today (tenant tz), excluding `cancelled` — matches the `total_spent` rule (D2 §7.F). Show currency.
- **Pedidos pendientes**: count of orders whose status `kind` ∈ {`new`, `awaiting_payment`, `awaiting_verification`, `processing`} (i.e. not shipped/delivered/cancelled). Click → `/orders` pre-filtered.
- **Acción necesaria**: count of (a) conversations with `needs_attention = true` (agent handed off / ceiling-hit) + (b) orders in `awaiting_verification` (payment proof to check). Click → the relevant filtered list. This is the coexistence owner's "you're needed here" list.
- **Campañas activas**: placeholder card ("Próximamente" or 0) — campaigns arrive in Phase 3. Wire the data path but don't fake numbers.

Below the cards, a compact "Acción necesaria" list (the actual conversations/orders, links into inbox/orders) is more useful than a bare count — build it if cheap; else the cards suffice for MVP. Empty/first-run state: encouraging copy explaining the agent will populate this as it works.

Reads: a `src/lib/home/` query module (typed, tenant-scoped, anon-key+RLS). Prefer a couple of aggregate queries over pulling rows; note any count that needs an RPC. No service key.

## 2. Settings (`/settings`) — PRD Screen 7

Tabbed/sectioned, **admin-only** (reps get "solo administradores"). Each master is a small CRUD over an existing table, reusing D1/D2 table+drawer patterns:

- **Atributos de cliente** (`attribute_defs`): manage the toggmable customer attributes the configurator's capture-picker and the customers screen read. Fields: key (immutable once created — it's referenced in `customers.attributes` and configs), label, type (`text`/`number`/`date`/`select`/`boolean`), options (for select), enabled, is_preset. Guard: disabling/deleting a def that's referenced by a published config's `capture.fields` warns first (don't silently break an agent). Deleting a def with data in `customers.attributes` → warn, and prefer disable over delete.
- **Estados de pedido** (`order_statuses`): rename the tenant-facing labels + reorder (`sort_order`) over the fixed `kind` set (phase-0: `(tenant_id, kind)` unique, 7 kinds). Owners rename ("Nuevo" → "Por confirmar") and reorder; they cannot add/remove kinds (the pipeline logic depends on kinds). Color per kind (reuse D2's mapping).
- **Métodos de pago** (`payment_methods`): CRUD — label, details (account/wallet the agent shares when `orders.sharePaymentMethods`), enabled. These flow into the agent's `create_order`/payment messaging and D2's order drawer.
- **Equipo** (`profiles`): list tenant users with role (admin/sales_rep); an admin can change another user's role (phase-0: only admin updates roles). **No invites** (Phase 4) — a note says so. An admin can't demote themselves if they're the last admin (guard).
- **Importación masiva**: link to D1's `/customers/import` (don't rebuild).
- **Canal de WhatsApp**: read-only status from `tenants` (`wa_channel_status`, `wa_phone_number_id`) + a "configuración en un paso próximo" note — Embedded Signup is Phase 4. Don't build token entry.

## 3. Timezone correctness (Phase-4-prep carry, do it here)

D2-D flagged `America/Bogota` hardcoded in dashboard date helpers. Home's "today" math makes this load-bearing now. **Thread `tenants.timezone` through the dashboard date helpers** (the runtime already does this correctly in R1 — mirror that approach with `Intl`, no date lib). "Ventas de hoy" and any "today"/date-range filter compute in the tenant's tz. Both seed tenants are Colombian, so add a test that fakes a non-Colombian tz to prove the boundary.

## 4. Tests

- Migrations: `verified_by` (+ optional nullable `prompt_version_id`) — isolation/meta/grants green; rep cannot write masters, admin can (canary).
- Home: KPI aggregate queries against seeded data (known totals — the D2 seed reconciliation gives stable numbers); "today" respects tenant tz (non-Colombian tz test); needs_attention + awaiting_verification counts correct.
- Settings: each master CRUD; attribute-def-in-use warning; order-status rename/reorder persists + orders reflect new labels; last-admin demotion guard; verified_by set + displayed.
- Nav guard: unsaved `/agent` change intercepts in-app nav (component test).
- `pnpm typecheck && pnpm lint && pnpm test && pnpm db:test` + prod build green.

## 5. Definition of done

- [ ] Carry-ins 0.1–0.2 landed (0.3 done or explicitly skipped with reason), each its own commit
- [ ] Demo (script in `SESSION_NOTES.md`): Home shows correct Ventas de hoy / Pendientes / Acción necesaria against seed (verify a number by hand); rename an order status and see it in `/orders`; add a payment method and a customer attribute, then see the attribute appear in the configurator capture-picker; verify a payment and see "verificado por"; change a rep↔admin role; confirm reps can't open Settings; "today" is tenant-tz correct
- [ ] Every UI string in `es.json`; no service key; admin-only gating verified; masters respect phase-0 role matrix
- [ ] Only §0/§3 migrations touch the DB; isolation + meta + eval suites green
- [ ] `SESSION_NOTES.md`: numbered assumptions, demo script, questions — **plus a short "Phase 2 complete" note**: what of the 8 PRD screens is now live and what's deferred to Phases 3–5
