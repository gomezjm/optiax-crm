# WS-D1 — Session notes (Customers screen + dashboard app shell)

Spec: `docs/specs/ws-d1-customers.md`. Branch `feat/ws-d1-customers` off `main`.
Previous sessions' notes live in `docs/session-notes/` (the R1 notes moved there
from this file, same convention as Phase 0/1).

**Status: every §9 DoD box checked.** `pnpm typecheck` / `pnpm lint` /
`pnpm test` (141: 45 shared + 28 dashboard + 68 runtime) / `pnpm db:test`
(221 isolation + 9 runtime integration + 7 new dashboard DB tests) all green;
`next build` production build passes. Verified live as `rep@modavalentina.test`
against the running dev server: authenticated `/customers` renders seeded data,
`?attr.talla_preferida=M` returns only Camila, `?tags=<VIP id>` only Juliana,
`?q=juli` search works, `?q=zzzz` shows the no-results state,
`/inbox?conversation=<id>` opens the thread, placeholder routes render
"Próximamente", unauthenticated requests 307 to `/login`. Zero runtime changes,
zero schema changes.

## What landed

- **App shell**: `(app)` route group with sidebar (Inicio, Bandeja, Clientes,
  Pedidos, Productos, Campañas, Agente IA, Configuración — non-live routes are
  "Próximamente" pages), tenant name, user menu with sign-out. Middleware now
  guards all app routes.
- **shadcn/ui + Tailwind v4 baseline**: `components.json` (preset `radix-nova`),
  copied components in `src/components/ui/` (button, badge, input, select,
  checkbox, dialog, dropdown-menu, sheet, table, label, separator, textarea,
  sonner). Later sessions add more via `pnpm dlx shadcn@latest add <name>`.
- **Customers list** (`/customers`): all spec columns, debounced server-side
  search, combinable URL-param filters (tags any-of, consent, source, per-def
  attribute filters, metric ranges), sortable headers, offset pagination
  (50/page, cursor upgrade path noted in `list.ts`), both empty states.
- **Detail drawer**: core fields, attribute-def-driven inputs, tag add/remove +
  inline tag creation (fixed 8-color palette), consent select with opt-out
  hint, read-only metrics, `Ver conversación` + `Abrir en WhatsApp` deep links.
- **Manual creation** with duplicate warn-and-link (`source: 'manual'`).
- **Mass edit**: selection + select-all-matching (500 cap), add/remove tags,
  set one attribute, set consent; chunks of 100; result toast.
- **CSV import wizard** (`/customers/import`): Papaparse upload → auto-matched
  header mapping (ES/EN aliases + attribute defs) → validation preview (first
  20 rows, per-row errors) → dedupe-skip import → result screen with failed-rows
  CSV download. Sample fixture: `apps/dashboard/fixtures/customers-import-sample.csv`.
- **Shared schemas**: `CustomerEditSchema`, `CustomerCreateSchema`,
  `CustomerImportRowSchema`, `normalizeCustomerPhone`, caps — in
  `packages/shared/src/schemas/customer.ts`.
- **Query module**: `apps/dashboard/src/lib/customers/` (filter model ↔ URL,
  pure query-plan translation, list/mutations/mass-edit/import, header
  matching, attribute conversion). Components never build queries inline.

## Assumptions & decisions (numbered, continuing the convention)

1. **shadcn CLI v3 realities**: the current CLI installs a `shadcn` runtime
   package (base styles come from `shadcn/tailwind.css`) plus `radix-ui`,
   `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`,
   `tw-animate-css`, `sonner`. All treated as part of the pre-approved
   "shadcn/ui copy-in" package deal. Papaparse (+`@types/papaparse`) and a
   direct `zod` dep were also added to the dashboard.
2. **`next-themes` was stripped**: the generated sonner component wanted it for
   theme switching; we hardcode `theme="light"` (no theming in this app) and
   removed the dependency.
3. **Geist font reverted**: shadcn init wired `next/font/google` (build-time
   network fetch). Kept the existing system font stack instead — builds must
   not depend on Google Fonts availability.
4. **`exactOptionalPropertyTypes` fix in a copied component**:
   `dropdown-menu.tsx` `checked={checked ?? false}` — copied components are our
   code and get fixed rather than loosening the compiler.
5. **`packages/shared` gained `"sideEffects": false` and a `browser` field**
   stubbing `dist/webhook-signature.js`. Client bundles otherwise fail on
   `node:crypto` via the barrel import. Node consumers (runtime, scripts) are
   unaffected — they don't read the `browser` field. Flagged as a question.
6. **Inbox moved into the `(app)` group** (URL unchanged). Its header lost the
   email + sign-out button (now in the sidebar user menu) and its `100vh`
   became `100%` — the sanctioned "shell + `?conversation=` link" changes; the
   thread/Realtime logic is untouched. `?conversation=<id>` preselects that
   conversation (unknown ids fall back to the first conversation).
7. **Phone storage**: manual creation/edit stores the phone as typed; CSV
   import stores the normalized digit form (spec §6 says import normalizes).
   All dedupe compares normalized digits, with suffix matching so `3015550101`
   matches a stored `573015550101`. Flagged as a question (unify?).
8. **Duplicate check is client-side over a fetched (id, name, phone, wa_id)
   index** (paged, 1000/page). There's no `(tenant, phone)` unique index and
   stored phones are formatted, so server-side exact matching can't work
   without a migration. Fine at MVP scale; noted in `mutations.ts`.
9. **`CustomerCreateSchema` exists** though the spec only named
   `CustomerEditSchema` — creation requires name + phone (§4) and the shared
   package is the only legal home for that shape.
10. **Import rows require `name` as well as `phone`** — a nameless directory
    entry from a spreadsheet is almost certainly a mapping mistake; the sample
    fixture exercises the error.
11. **Import consent aliases**: `sí`/`si`/`yes` → `opted_in`, `no` →
    `opted_out`, blank/absent → `unknown`; anything else is a per-row
    validation error (never silently `unknown`).
12. **"Optimistic update" reading (drawer save)**: the form keeps its state,
    errors toast (`saveError`) and nothing is lost; the list re-syncs via
    `router.refresh()`. Tag add/remove is truly optimistic with revert on
    error. Zod runs before every write; per-field messages come from
    `customers.validation.*` in `es.json`.
13. **Attributes writes are def-scoped and preserving**: only keys with
    enabled defs are written; unknown keys already in the jsonb (agent-captured)
    are preserved verbatim. Clearing an input removes the key.
14. **jsonb filter operators**: `->>`(text) for select eq, text contains and
    date ranges (ISO strings order lexicographically); `->`(jsonb) for boolean
    eq and number ranges. Select/date/tag/metric/combined filters are proven
    against PostgREST in the DB suite; boolean/number attribute filters are
    unit-tested only — the seed has no boolean/number attribute values (question
    below).
15. **Mass-edit `set_attribute` is read-modify-write per row** — PostgREST
    can't express a jsonb merge in an UPDATE. Bounded by the 500 cap, chunked
    reads. Tag add uses upsert on the `(customer_id, tag_id)` unique constraint
    with `ignoreDuplicates`.
16. **Select-all-matching fetches the matching ids (capped at 500)** at click
    time; the bar then operates on that explicit id list, so filter changes
    can't silently change the target set.
17. **Import failure isolation**: chunks of 100; a failed chunk insert retries
    row-by-row so one bad row reports itself instead of sinking 99 others.
    In-file duplicates (same digits) are skipped like existing-customer
    duplicates.
18. **Dashboard DB tests** live in `apps/dashboard/test/db/` (own vitest
    config, `ws` WebSocket shim like `supabase/tests/helpers.ts`), appended to
    root `db:test`. Random phone numbers per run + best-effort cleanup keep
    reruns idempotent. The rep-role canary asserts `auto_reply_rules` INSERT
    fails (admin-only write per Phase 0).
19. **Route naming**: placeholder routes use Spanish URLs (`/inicio`,
    `/pedidos`, `/productos`, `/campanas`, `/agente`, `/configuracion`) while
    the live Phase 1 route stays `/inbox` and D1 uses `/customers`. Flagged as
    a question before more screens harden the IA.
20. **`@/*` import alias added** to the dashboard tsconfig (shadcn requirement);
    new code uses it, moved inbox files were updated to it.

## Demo script (for Juan)

```bash
pnpm i
supabase start
supabase db reset          # migrations + seed.sql
pnpm seed:auth             # auth users + profiles + compiled prompts
pnpm --filter @optiax/dashboard dev   # http://localhost:3000
```

1. **Login** as `rep@modavalentina.test` / `password123` → lands on Bandeja;
   sidebar shows Moda Valentina, Clientes live, the rest "Pronto".
2. **Clientes** → seeded Camila Rojas + Juliana Torres with tags, consent
   badges, COP amounts, relative dates, source badges.
3. **Filter**: open Etiquetas → check VIP → only Juliana (URL now has
   `?tags=…` — copy it into a new tab to see shareability). Add Filtros →
   Talla preferida = S → still Juliana (combined). Quitar filtros.
4. **Edit**: click Camila → drawer. Change Barrio de entrega to `Laureles`,
   set Cumpleaños, Guardar → toast. Note read-only metrics, consent hint, and
   the **Ver conversación** (→ inbox thread) and **Abrir en WhatsApp** links.
5. **Create**: Nuevo cliente → name + phone `+57 300 111 2222` → Guardar →
   appears in list (source Manual). Try creating again with phone
   `301 555 0101` → duplicate warning + "Ver cliente existente" opens Camila.
6. **Mass edit**: select both seeded rows → Añadir etiquetas → Nueva → Aplicar
   → toast `2 actualizados, 0 errores`, badges appear.
7. **Import**: Importar CSV → `apps/dashboard/fixtures/customers-import-sample.csv`
   → mapping is fully auto-matched (talla/barrio/cumpleaños map to attributes)
   → Continuar → preview shows 6 error rows (fila 8 correo, 11 nombre, 12
   teléfono, 13 consentimiento, 14 fecha, 15 talla) → Importar → result:
   **12 importados, 2 omitidos** (Camila's phone + an in-file duplicate),
   **6 con error**; download the error CSV.
8. Checks: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:test` and
   `pnpm --filter @optiax/dashboard build`.

## Questions for the coordinator

1. **Phone normalization split** (assumption 7): import stores bare digits,
   manual entry stores as-typed. Unify on digits everywhere (display-format in
   the UI), or keep as-is until a `phone_normalized` column/index migration?
2. **`browser` + `sideEffects` fields on `packages/shared`** (assumption 5):
   acceptable, or should webhook-signature move to a subpath export
   (`@optiax/shared/webhook`) in the next runtime-touching session? That
   requires changing runtime/script imports, which was out of D1's scope.
3. **shadcn CLI extras** (assumption 1): the `shadcn` runtime package,
   `sonner`, `tw-animate-css` etc. — confirm they fall under the shadcn
   pre-approval so later sessions don't re-litigate.
4. **Spanish placeholder URLs** (assumption 19): lock in `/pedidos`,
   `/productos`, `/campanas`, `/agente`, `/configuracion` as the permanent IA,
   or rename to English for consistency with `/inbox`/`/customers` before D2?
5. **Boolean/number attribute filters** are unit-tested but have no seeded
   data to prove against PostgREST (assumption 14). Want a seeded
   boolean/number def (e.g. `acepta_mayorista` boolean) added to `seed.sql` in
   a later session so the DB suite can cover them?
