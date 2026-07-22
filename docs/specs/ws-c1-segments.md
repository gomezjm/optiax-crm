# Workstream C1 — Customer Segments

First Phase 3 session (PRD Screen 2). Dynamic customer grouping by rule. Deliberately builds the **shared segment→query evaluation engine** that C2's campaign broadcasts will reuse to resolve recipient lists — so get that engine right; the UI sits on top of it.

Read first: PRD Screen 2; `SegmentRulesSchema` (already in `packages/shared` from phase-0 — this session's job is to *use* and *evaluate* it, not redesign it); D1's `src/lib/customers/` filter-model→PostgREST translation (the closest precedent — segments are a richer version of the same idea); ratified decisions phase-0 §11 … **D4 §6**. Schema: `segments` table exists (name, rules jsonb, is_template); no schema change expected.

**Not in scope**: campaigns/broadcasts (C2 — but the evaluation engine you build is what C2 calls), sending anything, auto-replies (C2), editing the customers screen beyond reusing its table component.

## 1. The segment evaluation engine (shared — build first, test hard)

A pure translator in `packages/shared` (e.g. `@optiax/shared/segments`): `segmentRulesToQuery(rules: SegmentRules)` → a representation both the dashboard (PostgREST) and C2's runtime (server-side) can execute. Recommended: emit a normalized filter descriptor + a PostgREST-params builder, mirroring D1's proven pattern, rather than raw SQL strings.

- Cover every `SegmentRulesSchema` field and op (phase-0 §4): scalar fields (`total_spent`, `city`, `age_group`) → direct column predicates; date fields (`last_order_at`, `last_message_at`) with `older_than_days`/`newer_than_days` → computed timestamp bounds (in the tenant tz — mirror D4's `Intl` approach, no date lib); `tag` → membership via `customer_tags`; `attribute.<key>` → `customers.attributes->>'key'` jsonb predicate with type-aware comparison (the def's type governs numeric vs text vs date/boolean comparison).
- Combinator: `and` / `or` across conditions. PostgREST supports `or=(...)`; verify the exact syntax against a live query before building the UI on assumptions (probe it, like the artifact guidance — run one real query first).
- **Always tenant-scoped**: the engine produces the customer-filter portion only; tenant scoping is applied by the caller's RLS (dashboard) or the tenant repo (C2 runtime). Never bake a tenant id into the shared engine.
- Determinism + edge cases: empty rules → defined behavior (all customers, or none — pick and document; "all" is the natural "no filter"); unknown attribute key → no match (not an error); null field values handled explicitly. Unit-test every field/op/combinator permutation and the edge cases — this engine gates real money later (campaign audiences), so its test suite is the deliverable's core.

## 2. Segments screen (`/segments`)

- List: name, a live member count (evaluate the rules, head-only count — like D4's KPI counts), is_template badge, updated. Create / edit / delete (delete guards if a campaign references it — but campaigns don't exist yet, so just leave a `// C2: guard against referencing campaigns` note).
- **Rule builder**: a friendly visual editor producing valid `SegmentRules` — rows of {field, operator, value}, with the operator set and value input **driven by the chosen field's type** (date fields → the `older_than_days`/`newer_than_days` + a number, or a date; `tag` → tag picker from the tenant's tags; `attribute.<key>` → the picker lists enabled `attribute_defs`, value input typed by the def; `total_spent` → number). A top-level and/or toggle. Live-validate against `SegmentRulesSchema`; show inline errors from the Zod path.
- **Preview**: as rules are built, show the current match count and a sample of matching customers (reuse D1's customers table/row components, read-only) so the owner sees who they're targeting before saving. This preview runs the §1 engine through the anon-key + RLS client.
- Segment detail / view: the full member list (D1 table, read-only), with the customers updating automatically because the segment is evaluated live (never materialized).

## 3. Pre-built templates (PRD)

Seed a few `is_template = true` segments per tenant (in `seed.sql`) the owner can use or clone: **En riesgo** (`last_order_at older_than_days 30`), **VIP** (`total_spent gte <tenant-appropriate>`), **Solo curiosean / Window shoppers** (has messages but no orders — express within the schema if possible; if the schema can't express "has no orders", note the limitation and either extend the schema deliberately with a `COMPILER`-style version note or pick the closest expressible rule and document it). Templates are clonable into an editable tenant segment; editing a template itself is admin-only (they're shared defaults).

Note if `SegmentRulesSchema` can't express a PRD template cleanly (e.g. "no orders") — that's a real finding: either the schema needs a documented additive extension (new field/op, with tests) or the template is approximated. Flag the choice in `SESSION_NOTES.md`; do not silently drop a template.

## 4. Roles & data

- Segments are rep-writable (phase-0 matrix: operational). Verify with the seeded rep. Template segments (`is_template`) edited admin-only — enforce in UI + note that RLS doesn't distinguish template rows (app-layer guard; acceptable, document it).
- Anon key + RLS only; the evaluation runs through the user's client. No service key.
- Reads/writes through `src/lib/segments/` reusing the shared engine.

## 5. Tests

- Shared engine: exhaustive field/op/combinator matrix + edges (empty rules, unknown attr, null values, tenant-tz date bounds, tag membership, jsonb attribute typing). This is the priority suite.
- DB-backed (seeded users): each template returns the expected seeded customers; a compound and/or rule returns the right set; rep can create a segment, count matches seed; tenant isolation (segment eval as tenant A never sees B's customers — mostly covered by RLS, add a canary).
- Dashboard: rule-builder ↔ `SegmentRulesSchema` round-trip; type-driven operator/value inputs; preview count matches the saved segment's count.
- Isolation + meta + eval suites green; `pnpm typecheck && pnpm lint && pnpm test && pnpm db:test` + prod build green.

## 6. Definition of done

- [ ] Shared `segmentRulesToQuery` engine with an exhaustive unit suite; exported for C2 to reuse server-side
- [ ] Demo (script in `SESSION_NOTES.md`): open **En riesgo** template → see members; build a new segment ("VIP en Medellín": total_spent ≥ X AND city = Medellín) → preview updates live → save → member list correct against seed; a tag-based and an attribute-based rule each return the right customers; rep can create a segment
- [ ] PRD templates seeded; any schema-expressiveness gap flagged + resolved deliberately (not dropped)
- [ ] Every UI string in `es.json`; no service key; rep/admin gating verified; no schema change (or, if a template forced a deliberate `SegmentRulesSchema` extension: additive, versioned, tested, and flagged)
- [ ] `SESSION_NOTES.md`: numbered assumptions, demo script, questions

## 7. Addendum — ratified decisions + coordinator answers (2026-07-21)

All assumptions ratified, including the sharp probe finding that PostgREST can't put a joined column inside `or=()` (tags resolve to a base-table `id in (…)` set that composes under both combinators) — that shaped the engine correctly. Answers:

1. **Date-window semantics: unify on the tenant-local calendar day** (segments' approach — it matches D4/Home and the R1 runtime; "last 30 days" should mean calendar days to an SMB owner, and the same phrase must mean the same thing on the customers screen and in a segment). D1's customers filter uses a rolling `now − N·24h` and is the odd one out. **Carry-in to C2**: update the D1 customers date filter to the shared calendar-day bounds so the two agree. Low-stakes (hours at the boundary) but closes a real mental-model inconsistency before campaigns target on it.
2. **`is_set`/`is_empty` extension: ratified.** `SEGMENT_RULES_VERSION` → 2 is additive (every v1 rule still valid), versioned, tested, and reverts cleanly — the right way to make "Solo curiosean" (has messages, no orders) faithful rather than approximated. This is now a **canonical phase-0 contract**; C2 consumes the v2 engine. Recorded in phase-0 spec §4. Do not freeze back to v1.
3. **VIP seed thresholds (200k/300k) are placeholders** — fine for demo/tests. A real business's VIP cutoff is set at onboarding; no action now.
4. **`delete` C2-guard hook**: correct to stub — **C2 enforces** "can't delete a segment a running/scheduled campaign references."
