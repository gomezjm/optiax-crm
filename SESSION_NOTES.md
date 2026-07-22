# WS-C1 — Session notes (Customer Segments)

Spec: `docs/specs/ws-c1-segments.md`. Branch `feat/ws-c1-segments` off `main`.
Previous sessions' notes live in `docs/session-notes/` (D4's moved there this
session, same convention as Phase 0/1, R1, D1–D4, R1–R3).

Ratified inputs honoured as law: phase-0 §11 … **D4 §6**. Nothing in those was
"fixed". `main` contained every prerequisite (the `segments` table from phase-0,
`SegmentRulesSchema`, D1's customers table + filter→PostgREST precedent, D4's
tenant-tz `Intl` helpers) — no missing merge. **Not self-merged — Juan owns the
merge to `main`.**

First Phase 3 session. The deliverable's core is the **shared segment→query
evaluation engine** that C2's campaign broadcasts will reuse to resolve
recipient lists; the `/segments` screen sits on top of it.

---

## 1. What shipped

**Shared engine — `packages/shared/src/segments/`** (exported through the
`@optiax/shared` barrel, so C2 imports it the same way it imports schemas):

- `segmentRulesToQuery(rules, ctx)` → a normalized, portable `SegmentQuery`
  descriptor. Pure and **tenant-agnostic**: it emits the customer-filter portion
  only and never references a tenant id (tenant scoping is the caller's — RLS on
  the dashboard, tenant repo in C2). Deterministic given `ctx` (which carries
  `now`, `timeZone`, `attributeTypes`).
- `buildSegmentPostgrestPlan(query, { tagMembers })` → the PostgREST plan the
  dashboard applies (`and` → chained filters; `or` → one `.or(expr)` string).
  Tag conditions stay **symbolic** in the descriptor so C2 can resolve them via a
  SQL join; the dashboard executor resolves them to `id in (…)` (see assumption 2).
- Covers every field/op: scalar columns (`total_spent`, `city`, `age_group`),
  date columns (`last_order_at`, `last_message_at`) with tenant-tz calendar-day
  cutoffs, `tag` membership, and `attribute.<key>` jsonb with **type-aware**
  comparison (number → `->` numeric, text/select → `->>` text, boolean → `->`,
  date → `->>` text) driven by the attribute def's type.
- `validateSegmentRules` (field/op compatibility the Zod schema can't see) +
  `fieldType` / `opsForFieldType` / `valueInputFor` helpers that the rule builder
  and C2 both consume, so the UI can only ever emit valid rules.
- **Exhaustive unit suite** (`test/segments-query.test.ts` 42, plus
  `segments-date-bounds.test.ts` 6, schema 6): every field/op/combinator
  permutation, jsonb typing, tenant-tz date bounds (incl. DST-free CO + a
  non-CO zone + month/year rollover), tag resolution, `or`-expression escaping,
  and the edges — empty rules → all, unknown attr → no match (not an error),
  invalid op-for-field → throws, null handling, presence ops.

**Dashboard — `apps/dashboard/src/lib/segments/` + `src/app/(app)/segments/`:**

- `executor.ts` runs the shared plan through the anon-key + RLS client;
  `queries.ts` (list with live counts, members page, eval-context builder);
  `mutations.ts` (create / update / delete / clone); `rule-model.ts` (the
  type-driven builder model).
- `/segments`: list with a **live** member count per segment + template badge +
  updated; a type-driven **rule builder** (field → operator menu → value widget,
  all derived from the field's type) with a **live debounced preview** (count +
  sample member table, reusing D1's row primitives); a member **sheet** that
  re-evaluates live. Every string is in `es.json` (new `segments.*` block +
  `nav.segments`). Nav item + middleware matcher wired.

**Seed — `supabase/seed.sql`:** three `is_template` segments per tenant
(**En riesgo**, **VIP**, **Solo curiosean**), clonable; a window-shopper customer
(Sofía Herrera, tenant A) so "Solo curiosean" resolves to a real member.

**Verification (all green):** `pnpm typecheck && pnpm lint && pnpm test &&
pnpm db:test` + `next build`. Isolation + meta suites green (no new tables, so
the meta-test's RLS/tenant_id check is untouched). New tests: 42 engine + 12
schema/date-bounds (shared), 12 rule-model (dashboard unit), 9 DB-backed.

---

## 2. Numbered assumptions

1. **Empty rules → all customers.** `SegmentRulesSchema` forbids zero
   conditions, but the engine defines the empty case anyway (natural "no
   filter"). Unknown `attribute.<key>` (no enabled def) → **matches nothing**,
   never an error, per spec §1.
2. **Tag membership is resolved to `id in (…)`, not a join.** Probed against the
   live stack first: PostgREST **cannot** put an embedded/joined column inside an
   `or=()` (parse error), so a tag condition can't compose with scalar conditions
   under the `or` combinator via a join. Pre-resolving each referenced tag to its
   member customer-ids makes it a base-table `id=in.(…)` predicate that composes
   freely under both combinators and keeps `count: exact` correct (no join
   row-multiplication). The shared descriptor keeps tags symbolic so C2 may
   resolve them with a real SQL join instead. At MVP scale this is one small
   extra query per referenced tag.
3. **`older_/newer_than_days` anchor to the tenant's local calendar day**, not a
   rolling `now − N·24h` window (mirrors D4's `Intl` approach; no date lib). So
   "hasn't ordered in 30 days" is 30 calendar days in the tenant tz and doesn't
   drift hour-to-hour. `older` → `< startOfLocalDay(today − N)` (`lt`); `newer`
   → `≥` that instant (`gte`). D1's customers filter uses a rolling window; the
   two now differ intentionally — flagged as question 1.
4. **`neq` and ordered comparisons exclude null-valued rows** (SQL
   NULL-comparison semantics), verified live. `is_set` / `is_empty` are the
   explicit presence checks. For jsonb attributes, presence uses the `->>` text
   form so an **absent key reads as empty** (matches D1's attribute-filter
   intent).
5. **VIP thresholds are tenant-appropriate**, seeded per tenant: retail (Moda
   Valentina) ≥ 200 000, food (Sabor Casero) ≥ 300 000. "En riesgo" (30 days) and
   "Solo curiosean" are tenant-independent.
6. **Template-edit gating is app-layer only.** `segments` is `operational` in the
   RLS matrix — reps *and* admins can write any row, including `is_template` ones
   (RLS does not distinguish them). The UI hides edit/delete on templates for
   non-admins and the page gates by role; a rep can always *clone* a template
   into an editable segment. Acceptable and documented, exactly as the spec
   anticipated. A DB test documents that the RLS layer itself does not enforce it.
7. **Segments are evaluated live, never materialized** — counts and member lists
   run the engine on every load, so they always reflect current data.
8. **`SEGMENT_PREVIEW_LIMIT = 50`** rows for the preview and the member sheet
   (matches D1's `PAGE_SIZE`); the count is always the true total via
   `count: exact`. Full pagination of a large member list is deferred with D1's
   same keyset-pagination upgrade note.

---

## 3. The one deliberate schema extension (flagged loudly — see question 2)

The PRD "window shoppers" template = **has messages but no orders**. This was
**not expressible** in `SegmentRulesSchema` v1: there is no "orders count" field,
and "no orders" = `last_order_at is null`, but v1 had no null-presence operator.

**Decision (deliberate, additive, versioned, tested):** added two operators,
`is_set` and `is_empty`, to `SegmentOpSchema`. Rationale:

- It is the *faithful* expression of the template
  (`last_message_at is_set AND last_order_at is_empty`), not an approximation
  (the alternative — `total_spent lte 0 AND last_message_at newer_than_days N` —
  silently misreads all-cancelled orders and proxies "has messages" by recency).
- Explicit null handling is a first-class §1 requirement anyway, and `is_set` /
  `is_empty` will serve C2's audience targeting.
- It is **strictly additive**: every v1 rule stays valid, so nothing breaks if
  reverted. `value` became optional only to let presence ops omit it; a
  `superRefine` still requires it for every other op. Bumped
  `SEGMENT_RULES_VERSION` to `2` as a documentation marker (nothing branches on
  it yet).

No DB/migration touch — `rules` is already `jsonb`; isolation/meta/grants
untouched. Exhaustively tested (schema + engine + a DB-backed template test).

---

## 4. Demo script (against seed; `supabase db reset && pnpm seed:auth`)

Sign in as **rep@modavalentina.test** / `password123` (tenant A, Moda Valentina),
open **Segmentos**:

1. **Open a template →  see members.** "En riesgo" shows **1** — click the count
   → member sheet lists **Juliana Torres** (last order 41 days ago). "VIP" shows
   **2** (Camila 215k, Juliana 452k). "Solo curiosean" shows **1** →
   **Sofía Herrera** (messaged, never ordered — the `is_set`/`is_empty` template).
2. **Build a new segment live.** *Nuevo segmento* → name "VIP en Medellín";
   rule 1 `Total gastado` `es mayor o igual a` `200000`; *Agregar regla*; rule 2
   `Ciudad` `es igual a` `Medellín`; combinator "todas las reglas (Y)". The
   **preview updates live** → **1 coincidencia**, **Camila Rojas**. Save →
   appears in the list with a live count of 1.
3. **Tag-based rule.** New segment, `Etiqueta` `contiene` `VIP` → preview shows
   **Juliana Torres** (the only VIP-tagged customer).
4. **Attribute-based rule.** New segment, `Talla preferida` `es igual a` `M`
   (the operator menu + a value dropdown are driven by the def's `select` type)
   → preview shows **Camila Rojas**.
5. **Rep can create + templates are read-only to reps.** All of the above was as
   the seeded rep. Templates show no Edit/Delete in the rep's row menu (only
   *Duplicar*); the "solo administradores" note shows under the list.
6. **Isolation.** Nothing tenant-B (Andrés, María, all Bogotá) ever appears; a
   `Ciudad = Bogotá` rule previews **0** for tenant A.

DB-backed equivalents of all of this are in
`apps/dashboard/test/db/segments-db.test.ts`.

---

## 5. Questions for Juan

1. **Date-window semantics divergence.** Segments anchor `older_/newer_than_days`
   to the tenant's local calendar day (assumption 3); D1's customers filter uses a
   rolling `now − N·24h`. Both are defensible; segments feed campaigns, where an
   owner's "last 30 days" reads as calendar days. Want them unified (and if so,
   which way)?
2. **Ratify the `is_set` / `is_empty` schema extension** (§3). It's additive,
   versioned, tested, and reverts cleanly, but it's a change to a phase-0 contract
   C2 depends on — your call to bless it. If you'd rather keep v1 frozen, the
   fallback is to approximate "Solo curiosean" as
   `total_spent lte 0 AND last_message_at newer_than_days 365` and drop the two
   ops (I'd not recommend it — see the rationale).
3. **VIP thresholds** (200k retail / 300k food) are a guess for the seed. Real
   defaults are a business call; trivial to retune in `seed.sql`.
4. **`delete` has a `// C2:` hook** to guard against deleting a segment a campaign
   references — nothing to enforce until campaigns exist (C2).
