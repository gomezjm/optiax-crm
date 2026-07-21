# Workstream D3 — Agent configurator + Playground + Publish flow

The screen that makes the whole product usable by a non-technical owner: a wizard that edits the structured `agent_config` (never raw prompts), a Playground that tests the draft against the live runtime, and a Publish flow that runs R3's gate, compiles the prompt, and flips the pointer — the architecture doc's "automatic build." PRD Screen 5.

**This session touches BOTH runtime and dashboard** — deliberately. The Playground is the one genuine frontend→backend call in the whole system (architecture doc §2), so one session owning both ends of that single contract is correct: no cross-session drift on the one place they actually meet.

Read first: architecture doc §2 (configurator/playground) + §4 "Config publish"; PRD Screen 5; `agent_config` schema (phase-0 §5, `AgentConfigSchema` in `packages/shared`); R2's tool loop + R3's `evaluateDraft`/eval harness (the Playground and Publish reuse this machinery); D1's app-shell + form patterns; ratified decisions phase-0 §11 … **R3 §6**.

**Not in scope**: attribute_defs / order_status / payment_method *management* UIs (D4 Settings — the configurator only *reads* attribute_defs for the capture-field picker); products catalog CRUD (D2 owns it — the configurator edits catalog *policy*, not items); campaigns; team roles.

## 0. Carry-overs (ratified — each its own commit, first)

1. Rename `/inicio` → `/home` (D2 §7.A). 2. Relabel customers column "Total gastado" → **"Total en pedidos"** in `es.json` (D2 §7.F). 3. Orders manual composer writes `order_items.sort_order` in row order (R2 Q-A). 4. `pnpm recompile:prompts` script (`scripts/`): recompiles every tenant's **published** config at the current `COMPILER_VERSION` and updates the active `prompt_versions` — the "recompile on compiler bump" op owed since R2's 1.1.0 bump. Idempotent; logs per-tenant before/after version.

## 1. Runtime: draft-mode Playground endpoint (Part A — do before the UI)

`POST /playground` on `apps/runtime` (authenticated as the tenant — see §2 auth):

- Body: `{ config: AgentConfig (draft, unpublished), messages: [{role, text}] (conversation so far), newMessage: string }`.
- Behavior: validate `config` with `AgentConfigSchema`; compile it on the fly (the compiler, in-memory — do **not** write a `prompt_versions` row); run the **real R2 tool loop** with real tool *declarations*, but against an **ephemeral, non-persisting** execution context — reuse R3's `EvalDb`/pluggable-DB seam so `check_catalog` reads the tenant's **real** catalog (read-only) while `create_order`/`capture_customer` execute against a throwaway buffer and are **reported, not persisted**. No real WhatsApp send.
- Response: `{ reply: string, toolCalls: [{name, args, result}], turns: [...] }` so the UI can show both what the agent says *and* what it would do ("crearía un pedido por $X").
- Rate-limit per tenant (simple in-memory token bucket is fine) — it calls real Gemini and costs money.
- This endpoint is the **only** runtime change. Keep it in its own module; it reuses the loop, does not fork it.

## 2. Auth for the one FE→BE call

The dashboard calls `/playground` with the user's Supabase **access token** (Authorization: Bearer). The runtime verifies it (Supabase JWT), resolves the tenant from the token's claims, and scopes everything to that tenant — it never trusts a tenant id from the body. Document this as the canonical pattern for any future dashboard→runtime call. (CORS: allow the dashboard origin from env.)

## 3. Configurator wizard (`/agent`) — PRD Screen 5

Structured editor over `agent_configs` (draft row), validated live by `AgentConfigSchema`; **never exposes the compiled prompt**. Sections (wizard steps or a single sectioned form — pick the friendlier for a non-technical owner; save-as-draft at any point):

- **Negocio**: business name, description, vertical (select), address, hours text.
- **Personalidad**: agent display name, tone (`formal`/`cercano`/`neutral`), emoji usage, language (es, fixed v1).
- **Disponibilidad**: operating mode (`always`/`outside_hours`/`schedule`) — if `schedule` or `outside_hours`, a day/time picker (recall R1 §8.2: `outside_hours` now *requires* a schedule — enforce in the form); audio policy (`transcribe`/`text_reply`); pause-hours-on-owner-reply.
- **Catálogo**: policy toggles (`canQuotePrices`, `offerPromos`, out-of-stock behavior). A note that products live in Productos (link to `/products`) — this screen sets policy, not items.
- **FAQs**: repeatable q/a list (respect the compiler's length caps — surface them as maxlengths).
- **Captura de datos**: pick which fields the agent collects — the picker reads enabled `attribute_defs` (+ core identity fields) so keys always resolve (phase-0 §5 app-layer rule); mark required.
- **Pedidos**: `orders.enabled`, `confirmBeforeCreate`, `collectDelivery`, `sharePaymentMethods`.
- **Escalación / Handoff**: escalation triggers (keyword/payment_proof/complaint/human_request; keywords when needed), the handoff message.
- **Guardrails**: forbidden topics, custom rules.
- **Master toggle**: `tenants.agent_enabled` on/off (PRD "activate/deactivate globally") — prominent, separate from publish.

Validation errors render inline per field, mapped from the Zod error path (the schema returns structured path+message per phase-0 §5). Unsaved-changes guard on navigate.

## 4. Playground (embedded in `/agent`)

- Chat UI calling `/playground` with the **current draft** (saved or in-memory). Shows agent replies and, distinctly, tool actions ("🧾 Crearía un pedido: 2× Camisa — $89.000", "📇 Guardaría: nombre, ciudad"). Reset button clears the conversation.
- Makes clear it's a simulation (banner: "Modo prueba — no se envían mensajes reales ni se guardan pedidos").
- Handles endpoint errors gracefully (rate-limit, model timeout) with a friendly message.

## 5. Publish flow (the "automatic build")

Publish button (disabled while draft has validation errors):

1. Call R3's **`evaluateDraft(tenantId)`** (via the runtime, or the shared eval module if callable from the dashboard's server side — prefer a runtime `POST /publish/evaluate` mirroring §2 auth so the heavy model work stays server-side).
2. **Pass** → compile the draft, insert a new `prompt_versions` row, set `agent_configs` published + point `tenants.active_prompt_version_id` at it. Atomic (a DB function or careful ordered writes; the next inbound message must never see a half-published state). Toast success.
3. **Fail** → block publish; show **what broke** per eval case (the deterministic failures plainly, judge rationales as detail) so the owner can fix the config. Nothing is published.
4. Show current published version + "última publicación" timestamp; a draft-differs-from-published indicator.

Publishing is the only path that writes `prompt_versions` from the app (the seed script is the other, for dev). Respect `prompt_versions` immutability (phase-0: insert-only).

## 6. Roles & data

- Config editing + publish are **admin-only** (phase-0 role matrix: `agent_configs`/`prompt_versions` are admin-write). A `sales_rep` sees the screen read-only (or gets a "solo administradores" state) — verify against the seeded rep. Master toggle: admin-only too.
- Dashboard uses anon key + RLS for the config reads/writes it can do directly; the compile+publish writes to `prompt_versions` and `tenants.active_prompt_version_id` go through the runtime endpoint (service-scoped) since RLS blocks client writes to `prompt_versions` — decide cleanly and document (a `POST /publish` on the runtime doing eval+compile+flip in one authenticated call is the clean shape).

## 7. Tests

- Runtime: `/playground` returns replies + non-persisted tool actions (assert nothing lands in `messages`/`orders`); auth rejects a bad/again-tenant token; `/publish` blocks on a broken draft and flips the pointer on a good one (real Postgres). Rate-limit unit test.
- Dashboard: wizard↔`AgentConfigSchema` round-trip incl. the `outside_hours`-requires-schedule rule; capture-field picker only offers resolvable keys; publish success + failure UI states; admin-vs-rep gating; carry-over 0.1–0.3 regressions.
- `pnpm recompile:prompts` unit/integration: stale published version → recompiled to current, idempotent on rerun.
- Isolation + meta + eval suites green; `pnpm typecheck && pnpm lint && pnpm test && pnpm db:test` + prod build green. `COMPILER_VERSION` bump only if the compiler changed (it shouldn't here).

## 8. Definition of done

- [ ] Carry-overs 0.1–0.4 landed, each its own commit
- [ ] Demo (script in `SESSION_NOTES.md`): as admin, edit the draft config (change tone, add an FAQ, toggle a capture field) → Playground shows the changed behavior and a would-be order → Publish runs the gate; deliberately break the config (disable orders but keep an order-capturing instruction, or drop a required capture field) to see the gate **block with reasons**; fix it, publish, confirm a new `prompt_versions` row is active and the next `pnpm simulate inbound-text` uses it; as rep, the screen is read-only
- [ ] `/playground` + `/publish` are the only runtime changes; both verify the Supabase JWT and scope by token, never by body
- [ ] Nothing the Playground does persists; publish is atomic and `prompt_versions` stays insert-only
- [ ] Every UI string in `es.json`; no service key in the dashboard; admin-only gating verified
- [ ] `SESSION_NOTES.md`: numbered assumptions, demo script, questions

## 9. Addendum — ratified decisions + coordinator answers (2026-07-21)

All assumptions ratified — including the good catch that the dashboard order-list read never adopted migration 9's `(sort_order, created_at, id)` ordering (so the composer write would've been inert without the read fix). Answers:

- **A. Publish gate uses real Gemini when a key is present — correct.** R3 §4's "real-Gemini never gates a push" is CI-scoped; a human clicking Publish is a different context, and evaluating the draft against the *real* model is the only honest test of "will this config behave." Deterministic assertions are the hard block (model-independent); judge scores are advisory thresholds with margin. Ratified. *(Future: if real-model noise ever false-blocks a good config, add a "publicar de todos modos" override with confirmation — Phase 5 polish, not now.)*
- **B. Save-gated-on-valid: accept for MVP**, given the sectioned form limits how much is ever at risk. True partial-draft persistence (store loose JSON, re-hydrate an invalid draft) is a real onboarding-UX improvement → **backlogged**, candidate for a later dashboard pass. Not D4-mandatory.
- **C. Reps get read-only config + Playground: correct.** Playground persists nothing and is rate-limited; letting a salesperson test the agent is useful and low-cost. Ratified.
- **D. `beforeunload` guard is not enough** — it misses in-app sidebar navigation, which silently drops unsaved config. **Carry to D4**: add a full in-app navigation guard (intercept route changes with a confirm) for `/agent`. Browser-level is the MVP floor until then.
- **E. `business.vertical` as a select (retail/food): correct and required.** Free-text would leave the publish gate with no matching eval suite. The select grows as we add verticals (each ships with its template + eval suite, per the scaling path). Ratified.
