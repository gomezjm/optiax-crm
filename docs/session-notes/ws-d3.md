# WS-D3 — Session notes (Configurator + Playground + Publish)

Spec: `docs/specs/ws-d3-configurator-playground.md`. Branch `feat/ws-d3-configurator`
off `main`. Ratified inputs honoured as law: phase-0 §11, phase-1 §9, R1 §8,
D2 §7, R2 §8, **R3 §6**. This session touched **both** the runtime and the
dashboard, deliberately — the Playground is the one true FE↔BE call.

Do **not** self-merge to `main`; Juan owns the merge gate.

---

## 1. Numbered assumptions

Everything below was decided inside this session. Ratify, correct, or park each.

### Carry-overs (§0) — each its own commit, landed first

1. **`/inicio` → `/home`** (route dir, sidebar href, middleware matcher). It was
   the last Spanish URL; English routes are permanent (D1 §10.4). No inbound links.
2. **"Total gastado" → "Total en pedidos"** — relabelled **all three** occurrences
   (column header, metrics filter, drawer read-only field), not just the column,
   so the metric reads the same everywhere. D2 §7.F named "the customers column";
   leaving the filter/drawer inconsistent would have been a worse result.
3. **Composer `order_items.sort_order`**: the manual composer now stamps each line
   with its row index, **and** the order-items list read now sorts by
   `(sort_order, created_at, id)` — migration 9 prescribed that read order but the
   dashboard never adopted it, so writing `sort_order` alone would have had no
   visible effect. Legacy rows (default 0) degrade to prior behaviour.
4. **`pnpm recompile:prompts`** (`scripts/recompile-prompts.ts`): recompiles every
   tenant's *published* config at the current `COMPILER_VERSION`, inserts (or
   reuses) a `prompt_versions` row, and repoints `active_prompt_version_id`.
   Insert-only + idempotent (an already-current tenant is a no-op); logs per-tenant
   `before → after`. Verified idempotent on a real double-run.

### Runtime (§1, §2, §5)

5. **JWT auth pattern** (canonical for any future dashboard→runtime call):
   `createSupabaseAuthenticator` (in `src/db/`, so the service client stays
   module-private) calls `supabase.auth.getUser(token)` then loads the caller's
   `profiles` row. Tenant **and** role come from the token/profile, **never** from
   the request body. Injected into the app so tests substitute a fake.
6. **`/playground` calls `runToolLoop` directly**, not `processWebhookEvent`. The
   Playground is one turn of the loop, not an inbound WhatsApp message — no dedupe,
   no 24h window, no persistence. The loop and executors are reused verbatim; only
   the repo is swapped.
7. **Ephemeral non-persisting repo** (`createPlaygroundRepo`): catalog / order-status
   / tenant-meta reads delegate to the **real** tenant repo (read-only, so
   `check_catalog` quotes live prices and `create_order` prices from the real
   catalog); customer + order writes land in an in-memory buffer and are reported,
   never persisted; every method the loop never calls **throws**, so an unexpected
   path can only fail loudly. Non-persistence is asserted in both a unit test and
   the Postgres integration test.
8. **Publish is atomic via a DB function.** New migration `10` adds
   `public.publish_agent_config(...)` (security-definer plpgsql, execute granted to
   `service_role` only, like the queue-api fns): one transaction inserts the
   `prompt_versions` row, upserts the published config to the draft's content, and
   flips `active_prompt_version_id`. supabase-js can't open a transaction, so a
   function was the clean way to guarantee the next inbound never sees a
   half-published state. `prompt_versions` stays insert-only.
9. **Compile vertical = `tenants.vertical`** (matches seed-auth + recompile). **Eval
   suite selection = `config.business.vertical`** (matches R3's `evaluateDraft`).
   These align for the seed tenants; to keep them aligned the configurator
   constrains `business.vertical` to a `retail`/`food` select, so the suite always
   resolves (see Question E).
10. **Publish gate model layer.** The interactive publish button uses **real Gemini**
    (agent + judge) when `GEMINI_API_KEY` is set — matching the session brief
    ("Playground + publish gate call real Gemini") — and falls back to the
    deterministic `FakeModel` layer when no key is present, so local dev still works.
    This does **not** contradict R3 §4 ("real-Gemini never gates a *push*"): that
    forbids real Gemini in the **CI** gate, which is unchanged — the deterministic
    layer still runs in `pnpm test`/`db:test`. A human clicking Publish is a
    different, deliberate context. Crucially, the demo's "broken config blocks"
    outcome is **model-independent**: disabling orders makes `create_order` refuse,
    so the happy-path `order_count` check fails regardless of which model drove the
    turn. Automated tests inject the deterministic layer.
11. **Draft is the persistent working row.** Publish copies draft → published
    (upsert) and **leaves the draft intact**, so the "draft differs from published"
    indicator is a plain compare of the two configs and editing continues from the
    draft. The previous published config's content is preserved in the prior
    `prompt_versions.config_snapshot` (audit intact), so overwriting the published
    row loses nothing.
12. **Rate limit**: in-memory per-tenant token bucket (5 burst, ~1 token / 6 s ≈
    10/min) on `/playground` only — it's the only endpoint a member can hammer that
    calls Gemini. Publish endpoints are admin-only and heavier, so left un-bucketed.
13. **Endpoint access**: `/playground` is allowed for any authenticated tenant member
    (it persists nothing); `/publish` + `/publish/evaluate` are **admin-only** (403
    for a rep). CORS allow-list from `DASHBOARD_ORIGIN` (default
    `http://localhost:3000`). See Question C.

### Dashboard (§3–§6)

14. **Single sectioned form**, not a multi-step wizard — friendlier for a
    non-technical owner and less state. Live `AgentConfigSchema` validation on every
    change; inline per-field errors mapped from the Zod `path`. The compiled prompt
    is never rendered.
15. **Save persists only a schema-valid config** (Save is disabled while invalid).
    "Save-as-draft at any point" (§3) is interpreted as "save whenever, but a stored
    draft is always valid" — the form seeds from an always-valid published baseline,
    so this is not a real limitation. Keeps the DB draft readable and the publish
    gate meaningful. See Question B.
16. **Capture picker** offers the core `capture_customer` identity columns
    (`name`, `email`, `address`, `city`, `gender`, `age_group`) plus **enabled**
    `attribute_defs`; a core column wins a key collision. Every offered key passes
    `CaptureFieldSchema`, so a captured value always resolves (phase-0 §5 app rule).
17. **`outside_hours`/`schedule`** modes seed a default weekday 09:00–18:00 schedule
    in the form the moment they're selected, so the form is never in an invalid
    intermediate state; the schema still enforces the rule (R1 §8.2).
18. **Master toggle** (`tenants.agent_enabled`) writes directly via anon+RLS
    (admin-only). A rep's toggle write is a **silent RLS no-op** (0 rows, no error) —
    verified in a DB test. Config edits + publish are admin-only; a rep sees the
    whole screen read-only with a "solo administradores" banner.
19. **Unsaved-changes guard** is `beforeunload` (browser nav / refresh / close). Full
    App-Router intra-app navigation interception is **not** implemented — Next lacks
    a stable API for it. See Question D.
20. **Playground sends the current form config** (saved or not) in each request body,
    so you can test edits before saving. Tool actions are shown distinctly from the
    reply ("🧾 Crearía un pedido: $110.000", "📇 Guardaría: city"), with a "modo
    prueba" banner and friendly rate-limit/timeout/unauthorized states.

---

## 2. Demo script

Prereqs: `supabase start && supabase db reset && pnpm seed:auth`
(Kong quirk → `docker restart supabase_kong_optiax-crm`). Put a real
`GEMINI_API_KEY` in `apps/runtime/.env.local`. Run both processes:

```bash
pnpm --filter @optiax/runtime dev      # :8787 — webhook + /playground + /publish
pnpm --filter @optiax/dashboard dev    # :3000
```

1. **Login as admin** `admin@modavalentina.test` / `password123`, open **Agente IA**.
2. **Edit the draft**: change Tono to *Formal*, add an FAQ, toggle a capture field
   (e.g. mark *Ciudad* required). Inline validation updates live; the "Cambios sin
   guardar" badge appears.
3. **Playground** (right panel): "Hola, ¿tienen la blusa Manuela?" → the agent quotes
   the **live** catalog price. "Quiero 2, confirmo" → the reply plus a distinct
   action card **"Crearía un pedido: $…"** and **"Guardaría: …"**. Banner confirms
   nothing is sent or saved.
4. **Save borrador**, then **Publicar** → gate runs, publishes; toast success; "Última
   publicación" timestamp updates and the differs indicator clears. A new active
   `prompt_versions` row now exists.
5. **Break the gate**: turn **Pedidos → off** (disable orders), Save, **Publicar**.
   The gate **blocks** and lists what broke per case (e.g. the happy-path case's
   `order_count` check failed) — **nothing is published**. Re-enable orders, Save,
   Publicar → success.
6. **Confirm the runtime uses it**: `pnpm simulate inbound-text` (targets Moda
   Valentina) → the worker reply reflects the just-published prompt (the active
   pointer moved to the freshly compiled version).
7. **Login as rep** `rep@modavalentina.test` → **Agente IA** is read-only: the
   "solo administradores" banner, no Save/Publish buttons, master toggle disabled.

Automated proof of the same behaviour, no Gemini required:
`apps/runtime/test/integration/publish.test.ts` (atomic flip + blocked broken draft +
Playground persists nothing) and `apps/dashboard/test/db/agent-db.test.ts`
(admin-vs-rep RLS).

---

## 3. What runs where / how to run it

- **Full gate (all green this session)**: `pnpm typecheck && pnpm lint && pnpm test &&
  pnpm db:test` + `pnpm --filter @optiax/dashboard build`.
  Unit 353 (shared 87 / dashboard 96 / runtime 170); db-suite 288 (isolation+meta 221 /
  runtime integration 21 / dashboard db 46).
- **Publish gate cost/latency**: with a Gemini key the publish button runs the vertical's
  full suite (5–10 fixtures) against real Gemini for both agent and judge — seconds and a
  few cents per publish. The deterministic layer (tests, and the no-key fallback) is
  network-free and instant.
- **New env**: runtime `DASHBOARD_ORIGIN` (CORS, default `http://localhost:3000`);
  dashboard `NEXT_PUBLIC_RUNTIME_URL` (default `http://localhost:8787`). Both have local
  defaults; `.env.example` updated.
- **No compiler change** — `COMPILER_VERSION` untouched (1.1.0). No new deps.

---

## 4. Questions for the coordinator

- **A. Publish gate model layer** (assumption 10): I run the *interactive* publish gate
  on real Gemini when a key is present (per the brief), deterministic otherwise, and read
  R3 §4's "real-Gemini never gates a push" as scoped to CI. Is that the intended split, or
  should the publish button always use the deterministic layer and keep real Gemini to
  `eval:live`?
- **B. Save-while-invalid** (assumption 15): Save is disabled until the config validates.
  Acceptable, or do you want true partial-draft persistence (store arbitrary JSON and
  re-hydrate an invalid draft into the form)?
- **C. Playground for reps** (assumption 13): I let any member run the Playground since it
  persists nothing — but it costs Gemini. Should reps be blocked entirely (screen fully
  inert), or is read-only-plus-Playground right?
- **D. Unsaved-nav guard** (assumption 19): `beforeunload` only. Want a full in-app
  navigation guard (intercept sidebar clicks with a confirm dialog) now, or is browser-level
  enough for MVP?
- **E. `business.vertical` as a select** (assumption 9): constrained to `retail`/`food` so
  the eval suite always resolves. Fine, or should it be free text with the suite falling
  back to retail for unknown verticals (and the compile staying on `tenants.vertical`)?

---

## 5. Files of note

- Runtime: `src/db/index.ts` (authenticator + `publishConfig` + `getTenantMeta`),
  `src/http/{api-routes,rate-limit}.ts`, `src/playground/{playground,playground-repo}.ts`,
  `src/publish/publish.ts`, `src/app.ts` (mounts the routes).
- Shared: `src/schemas/runtime-api.ts` (the one FE↔BE contract).
- DB: `supabase/migrations/20260721000100_publish_agent_config_fn.sql`.
- Dashboard: `src/app/(app)/agent/*` (page + client + form + panels + fields),
  `src/lib/agent/*` (queries/mutations/runtime/capture-fields/env), `src/i18n/es.json`.
- Scripts: `scripts/recompile-prompts.ts`.
