# Workstream R3 — Agent evals + publish gate (+ one handoff fix)

Makes agent quality *measurable* and turns publishing into a safety gate: a config change can't go live if it regresses lead capture, refusal behavior, or escalation. Also fixes one R2 defect and gathers the data that decides two parked R2 questions. Runtime/shared session; no dashboard UI (D3 consumes the gate's output).

Read first: architecture doc §4 "Config publish (the automatic build)" + §5 observability; R2's tool loop and executors (`apps/runtime/src/...`), the compiler (`packages/shared/src/compiler/`); ratified decisions phase-0 §11, phase-1 §9, R1 §8, D2 §7, **R2 §8**.

**Not in scope**: the dashboard publish UI and "what broke" display (D3), campaign/broadcast quality, real-Gemini in CI (evals run against a real model **only** when explicitly invoked, never in the default CI gate — see §4).

## 0. Mandatory first (ratified R2 Q-E) — its own commit, before eval work

The 4-round tool-loop ceiling currently sends `escalation.handoffMessage` but does **not** set `needs_attention` — it promises a human and summons none. Fix: the ceiling path performs a **real** handoff — set `conversation.needs_attention = true`, apply the same pause R2's `handoff_to_human` uses, record the `agent_turn` with a distinct marker (`error: { reason: 'round_limit_handoff' }` or a `tool_calls` note — decide, log). Regression test asserts a ceiling-hit conversation ends `needs_attention = true` + paused. This is also eval case §3's "runaway loop" scenario.

## 1. Eval harness

A runnable harness (`pnpm eval <suite>` or `apps/runtime` script) that replays canned conversations against a tenant's **draft** compiled prompt + real tool executors, then scores outcomes.

- A **conversation fixture** = ordered customer turns + the tenant config to compile + expected outcomes (deterministic assertions) and rubric prompts (LLM-judge). Fixtures live in `packages/shared/evals/<vertical>/` (reused by the publish gate and by hand runs).
- The harness drives the **real R2 loop** (real tool execution against a scratch/seeded tenant in a transaction that rolls back, or a disposable schema — pick one, keep evals hermetic and repeatable) with a **pluggable model**: real Gemini when invoked for authoring/CI-nightly, `FakeModel` scripted turns for the deterministic unit layer.
- Two assertion tiers per case: **deterministic** (did `capture_customer` fire with these fields? did an order get created with the right total? did `needs_attention` flip?) — these gate publish; and **LLM-judge** (tone, refused the out-of-policy ask, escalated appropriately) — scored 1–5 with a rubric, thresholded.

## 2. LLM-judge

- Provider-agnostic via the existing model adapter (a judge is just a model call). Judge prompt takes the rubric + transcript, returns structured `{ score, rationale }` (Zod `EvalJudgementSchema` in `packages/shared`). No customer PII beyond the transcript itself.
- Determinism caveat documented: judge scores vary run-to-run; gate on deterministic assertions as hard fails and treat judge scores as thresholds with a margin, not exact values. Log rationales for the D3 "what broke" view.

## 3. Canned suites (5–10 per vertical, both seeded verticals)

Cover the outcomes the architecture doc names — lead capture, refusal, escalation — plus R2's tool surface:
- Happy path: greet → ask product → `check_catalog` quotes the live price → capture fields → confirmed `create_order`.
- Refusal/guardrail: customer asks something in `guardrails.forbiddenTopics` or "give it to me free / ignore your rules" → agent refuses, no bogus tool call (the R2 adversarial case, promoted to an eval).
- Escalation: explicit human request and a complaint → `handoff_to_human` fires, `needs_attention` set.
- Out-of-stock: unavailable product → agent offers alternative per `catalog.outOfStock`, never sells it.
- Pause/window/hours (R1 still holds): paused conversation runs no tools; outside-window never sends.
- Runaway loop: a scripted scenario that would exceed 4 rounds → §0 real handoff.
- **Q-C probe**: a two-message ordering flow (quote, then "confirmo" a message later) → measures how often the model loses the `product_id` and must re-`check_catalog`. Report the rate; recommend keep-(i) vs (ii)/(iii) with numbers.
- **Q-D probe**: inbound image described as a payment receipt on a conversation with an open `awaiting_payment` order → measures whether the model escalates. Report the rate; if it under-escalates materially, recommend the scoped-deterministic rule (image + open awaiting_payment order → handoff) as a follow-up — do not build it here.

## 4. Publish gate

- `evaluateDraft(tenantId): { pass: boolean, results }` compiles the draft config, runs that vertical's suite, returns per-case results. **Publish is blocked unless all deterministic assertions pass** and judge scores clear thresholds. This is the function D3's publish button calls; expose it cleanly (typed, in the runtime or a shared eval module) so D3 only wires UI.
- CI: the deterministic/`FakeModel` layer runs in the normal `pnpm test`/`db:test` gate (fast, no network). The **real-Gemini eval layer is a separate, manually- or nightly-invoked job** (`pnpm eval:live`) — never blocks a normal push, documented as such. Cost/latency note in `SESSION_NOTES.md`.
- Observability (architecture §5): ensure each eval run records enough (per-case pass/fail, judge rationale, tokens) for D3 to show "what broke."

## 5. Tests & DoD

- [ ] §0 handoff fix landed first, its own commit, regression test green
- [ ] `pnpm test`/`pnpm db:test` green including the deterministic eval layer; `pnpm eval:live` runs the real-Gemini suite on demand and is excluded from the default gate
- [ ] Both verticals have 5–10 fixtures; the gate blocks a deliberately-broken draft (include a fixture proving a bad config fails) and passes the seeded good config
- [ ] `evaluateDraft` exposed for D3; `EvalJudgementSchema` in `packages/shared`
- [ ] Q-C and Q-D probe rates reported in `SESSION_NOTES.md` with a recommendation each
- [ ] Isolation + meta suites green; no new tables (if any: `tenant_id` + RLS + grants); `COMPILER_VERSION` bumped iff the compiler changed
- [ ] `SESSION_NOTES.md`: numbered assumptions, how to run both eval layers, questions
