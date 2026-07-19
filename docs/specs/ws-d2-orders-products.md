# Workstream D2 — Orders + Products screens

PRD Screens 4 and 6. Dashboard session building on D1's shell and patterns (query modules, URL-param filters, drawers, shadcn components, `es.json`). One deliberate schema addition: the `total_spent` denormalization trigger.

Read first: PRD Screens 4 + 6; D1 code (`apps/dashboard/src/lib/customers/`, components — copy its architecture); ratified decisions (phase-0 §11, phase-1 §9, R1 §8, **D1 §10**). Schema: `orders`, `order_items`, `order_statuses`, `payment_methods`, `products`, `product_categories`.

**Not in scope**: agent order auto-capture and payment-proof OCR (R2 — runtime), campaigns attribution, PDF export (CSV only; PDF is a later nice-to-have), order_statuses / payment_methods management UI (D4 Settings — D2 reads masters), inbox changes.

## 0. Carry-overs from D1 ratifications (do these first)

1. Rename placeholder routes to English: `/orders`, `/products`, `/campaigns`, `/agent`, `/settings` (D1 §10.4). Labels stay Spanish.
2. Unify phone normalization: manual customer entry normalizes via `normalizeCustomerPhone` like import does (D1 §10.1).
3. Seed one boolean (`acepta_mayorista`) + one number attribute def per tenant (`seed.sql` — editable, unlike migrations) and extend the dashboard DB suite to prove boolean/number attribute filters against PostgREST (D1 §10.5).

## 1. Products screen (`/products`) — PRD Screen 6

- List: image thumb, name, category, price, promo price (promo shown with original struck through — the PRD's display rule), availability badge, updated. Search by name; filter by category + availability; sort by name/price/updated. Same URL-param + query-module architecture as D1.
- Create/edit drawer: name, description, category (select + inline create — `product_categories` is rep-writable), price, promo_price (validate `promo < price`), available toggle, **images: up to 2** — upload to Storage bucket `media` under `{tenant_id}/products/{product_id}/`, preview, delete. Client-side downscale to ≤1600px/JPEG before upload (canvas API, no new dependency) — these get sent over WhatsApp later.
- Availability toggle directly in the list row (the "stop selling this NOW" panic action — one click, optimistic).
- No delete for products referenced by order_items (FK will refuse; catch and offer "marcar no disponible" instead). Unreferenced products may be deleted with confirm.
- Zod: `ProductSchema`, `ProductCategorySchema` in `packages/shared` (R2's `check_catalog` tool will reuse them).

## 2. Orders screen (`/orders`) — PRD Screen 4

- List: short id (first 8 of uuid), customer name (link), items summary ("2× Camisa M, 1× …" truncated), total (tenant currency), status (colored select, inline-changeable per §3), payment state (chip: sin pago / ref. registrada / **comprobante subido — por verificar** / verificado), delivery date, source, created. Filters: status, payment state, delivery date range, created range, search by customer name/phone. Sort: created, delivery_date, total. Pagination as D1.
- Detail drawer: items table (product, qty, unit price, subtotal) + total; customer card (link to `/customers` drawer + conversation deep links, reusing D1 components); status select; payment section — method (from `payment_methods` master), reference field, proof image (render from `payment_proof_media_path` if set; manual upload allowed to `{tenant_id}/orders/{order_id}/`), **"Marcar pago verificado"** button → sets `payment_verified_at` (display who/when? no user column exists — display timestamp only; log a note if you think we need `verified_by` later); logistics — delivery_address (prefill from customer address), delivery_date, driver_notes.
- Manual creation: customer picker (search, or "create new" via D1's drawer), item rows from product picker (unit_price prefilled from current/promo price, editable; `description` denormalized from product name per schema), computed total (sum of items — no override), payment method, logistics. `source: 'manual'`, initial status = tenant's `kind='new'` status. Products marked unavailable are pickable with a warning (owner may be logging an offline sale).
- **Quick Export (CSV)**: exports the *currently filtered* list — columns: customer, phone, delivery address, delivery date, items summary, total, payment state, driver notes. Papaparse `unparse`, filename `pedidos-YYYY-MM-DD.csv`. This is the moto/Rappi handoff (PRD); default filter shortcut "Entregas de hoy".
- Zod: `OrderCreateSchema`, `OrderUpdateSchema` (status/payment/logistics subsets) in `packages/shared` (R2's `create_order` tool will reuse `OrderCreateSchema`).

## 3. Status pipeline

Statuses come from the tenant's `order_statuses` ordered by `sort_order` (D4 owns editing them; seed provides all 7 kinds). Status change = update `status_id`, allowed from any status to any status (no transition rules in MVP — owners fix mistakes; log a SESSION_NOTES question if this feels wrong in practice). Colors by `kind` (new=blue, awaiting_payment/awaiting_verification=amber, processing=violet, shipped=cyan, delivered=green, cancelled=gray).

## 4. `total_spent` trigger — the one schema change

New migration (append-only, no new table — meta-test unaffected): trigger function on `orders` (INSERT/UPDATE/DELETE) that **recomputes** the affected customer's `total_spent` (sum of `orders.total`) and `last_order_at` (max `created_at`) over that customer's orders whose status kind ≠ `cancelled`. Full recompute per affected customer, not incremental deltas — simple and self-healing. Fires for service-role writes too, so R2's agent-created orders inherit it for free. `security definer` owned function; RLS untouched.

Revisitable-later note in the migration comment: whether `awaiting_payment` orders should count toward `total_spent` (they do in v1 — only `cancelled` is excluded).

## 5. Tests

- Unit: filter→PostgREST translation for both screens, all new Zod schemas, items-total computation, CSV export row shaping, promo<price validation.
- DB-backed (seeded users): manual order creation → trigger updates `total_spent`/`last_order_at`; cancelling an order → totals recomputed down; status change persists; rep-role canary (rep CAN write orders/products; CANNOT write `order_statuses`/`payment_methods`); boolean/number attribute-filter proof (carry-over 0.3); storage upload path respects tenant prefix (write to own prefix ok — cross-tenant denial is already covered by the isolation suite).
- Isolation + meta suites green (the migration adds no table; if the meta-test flags anything, fix forward). Production build passes.

## 6. Definition of done

- [ ] Demo (script in `SESSION_NOTES.md`): create product with photo → toggle availability from list → create manual order for a seeded customer (watch prefills) → move it through the pipeline → upload proof + register reference + verify payment → confirm customer's `total_spent`/`last_order_at` updated in `/customers` → export "Entregas de hoy" CSV → boolean/number filters return correct rows
- [ ] Carry-overs 0.1–0.3 done; routes renamed everywhere (nav, middleware, links)
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm db:test` + production build green
- [ ] Every UI string in `es.json`; no service key; only the §4 migration touches the DB
- [ ] `SESSION_NOTES.md`: numbered assumptions, demo script, questions
