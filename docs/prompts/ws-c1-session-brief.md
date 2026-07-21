# Session brief: Workstream C1 — Customer Segments

*(First Phase 3 session. Run only after `feat/ws-d4-home-settings` is merged to `main`. Paste everything below into Claude Code at the repo root.)*

---

You are building **workstream C1** of the Optiax WhatsApp CRM: Customer Segments (PRD Screen 2) — dynamic, rule-based customer groups. The centerpiece is a **shared segment→query evaluation engine** that C2's campaign broadcasts will reuse to resolve who receives a message, so build and test that engine first; the UI sits on top of it.

## Read first, in this order
1. `docs/specs/ws-c1-segments.md` — your spec. §1 (the engine) before the UI.
2. `SegmentRulesSchema` in `packages/shared` (phase-0) — you *use and evaluate* it; you do not redesign it (a deliberate additive extension is allowed only if a PRD template can't be expressed — see §3, and flag it).
3. D1's `src/lib/customers/` filter→PostgREST translation — the precedent to mirror. Ratified decisions phase-0 §11 … D4 §6.

## Setup
- Branch `feat/ws-c1-segments` off `main`. **Do not self-merge to `main`** — Juan owns the merge; if `main` lacks a prerequisite, stop and say so.
- `supabase start && supabase db reset && pnpm seed:auth` (Kong quirk → `docker restart supabase_kong_optiax-crm`).
- **Probe before you build**: run one real PostgREST `or=(...)` / jsonb / tag-membership query against seeded data to confirm syntax before writing the engine on assumptions.

## Deliverables (detailed in the spec)
1. Shared `segmentRulesToQuery` engine covering every field/op/combinator + edges, tenant-tz date bounds, jsonb attribute typing, tag membership — exported for C2 (§1).
2. `/segments` screen: list w/ live counts, type-driven rule builder, live preview of matching customers, segment member view (§2).
3. Pre-built templates seeded (En riesgo / VIP / Window shoppers), clonable; any schema-expressiveness gap flagged + resolved deliberately (§3).
4. `src/lib/segments/` reusing the engine; rep/admin gating (§4).
5. Tests per §5 — the engine's exhaustive unit suite is the priority; demo + `SESSION_NOTES.md` per §6.

## Hard rules
- The evaluation engine is **pure and tenant-agnostic** — it emits the customer-filter portion only; tenant scoping comes from RLS (dashboard) / the tenant repo (C2). Never bake a tenant id into it.
- Segments are evaluated **live, never materialized** — counts and member lists reflect current data.
- Anon key + RLS only; no service key; segments are rep-writable, template rows admin-edit (app-layer guard, documented).
- Types/schemas from `packages/shared`; reuse `SegmentRulesSchema` verbatim unless a template forces a **deliberate, additive, versioned, tested** extension (flag it loudly). No `any`; every UI string in `es.json`; no new deps.
- No schema change expected; if a `SegmentRulesSchema` extension needs a DB touch, it's a new migration with isolation/meta/grants green.
- Ratified decision seems wrong → log it, don't change it.

## Definition of done
Spec §6 checklist, all boxes. The engine must be exported and exhaustively tested (C2 depends on it). End with `SESSION_NOTES.md`: numbered assumptions, demo script, questions.
