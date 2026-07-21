# Session brief: Workstream D3 — Configurator + Playground + Publish flow

*(Run only after `feat/ws-r3-evals` is merged to `main`. Paste everything below into Claude Code at the repo root.)*

---

You are building **workstream D3** of the Optiax WhatsApp CRM: the agent configurator wizard (PRD Screen 5), the Playground (test chat against the live runtime in draft mode), and the Publish flow (runs R3's gate, compiles the prompt, flips the active pointer — the "automatic build"). This session **touches both the runtime and the dashboard**, deliberately: the Playground is the one true frontend→backend call in the system, so one session owns both ends of that single contract.

## Read first, in this order
1. `docs/specs/ws-d3-configurator-playground.md` — your spec. §0 carry-overs first; §1 runtime endpoint before the UI.
2. Ratified decisions: phase-0 §11, phase-1 §9, R1 §8, D2 §7, R2 §8, **R3 §6**. Do not "fix" any of them.
3. `AgentConfigSchema` (phase-0 §5), R2's tool loop, **R3's `evaluateDraft` + eval harness** (Playground and Publish reuse this machinery — study it before writing §1), D1's app-shell/form patterns.

## Setup
- Branch `feat/ws-d3-configurator` off `main`. **Do not self-merge to `main`** — Juan owns the merge gate; if `main` lacks a prerequisite, stop and say so.
- `supabase start && supabase db reset && pnpm seed:auth` (Kong quirk → `docker restart supabase_kong_optiax-crm`).
- Real `GEMINI_API_KEY` in `apps/runtime/.env.local` (Playground + publish gate call real Gemini); automated tests use `FakeModel`.

## Deliverables (detailed in the spec)
1. §0 carry-overs: `/inicio`→`/home`; "Total gastado"→"Total en pedidos"; composer `sort_order`; `pnpm recompile:prompts` script.
2. Runtime `POST /playground` — draft compile + real tool loop against a non-persisting context (reuse R3's pluggable-DB seam), returns replies + would-be tool actions (§1).
3. Runtime `POST /publish` (+ `/publish/evaluate`) — Supabase-JWT auth, tenant from token never body; eval→compile→flip pointer atomically (§2, §5).
4. Configurator wizard over `agent_configs` draft, live Zod validation, never shows the compiled prompt, master toggle (§3).
5. Playground UI showing replies + tool actions, "modo prueba" banner (§4).
6. Publish UI: gate pass → publish; fail → show what broke; admin-only gating (§5, §6).
7. Tests per §7; demo + `SESSION_NOTES.md` per §8.

## Hard rules
- `/playground` + `/publish` are the **only** runtime changes; both verify the Supabase JWT and scope by token claims, never by a body-supplied tenant id. The service client stays in `src/db/`; the tool loop is reused, not forked.
- Nothing the Playground does may persist (assert it in tests). Publish is atomic; `prompt_versions` stays insert-only (never UPDATE/DELETE — phase-0 immutability).
- Config editing + publish are admin-only (phase-0 role matrix); reps get read-only.
- Types/schemas from `packages/shared`; reuse `AgentConfigSchema` + R3's eval schemas verbatim; no `any`; every UI string in `es.json`.
- No new deps beyond what D1/shadcn already approved. No compiler change expected — if you touch it, bump `COMPILER_VERSION` + snapshots.
- Isolation + meta + eval suites green; `pnpm db:test` before done. Ratified decision seems wrong → log it, don't change it.
- Scope: no Settings masters UI, no products CRUD, no campaigns, no team roles.

## Definition of done
Spec §8 checklist, all boxes. The demo must show the gate **blocking a broken draft with readable reasons** and a successful publish that the next simulated inbound message actually uses. End with `SESSION_NOTES.md`: numbered assumptions, demo script, questions.
