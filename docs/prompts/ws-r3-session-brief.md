# Session brief: Workstream R3 — Agent evals + publish gate

*(Run only after `feat/ws-r2-agent-tools` is merged to `main`. Paste everything below into Claude Code at the repo root.)*

---

You are building **workstream R3** of the Optiax WhatsApp CRM: an eval harness with an LLM-judge and a **publish gate** that blocks a config change from going live if it regresses lead capture, refusal, or escalation. You also fix one R2 defect first and gather data that settles two parked R2 questions. Runtime/shared work; no dashboard UI (D3 consumes what you expose).

## Read first, in this order
1. `docs/specs/ws-r3-evals.md` — your spec. §0 (the handoff fix) is committed before any eval work.
2. Ratified decisions: phase-0 §11, phase-1 §9, R1 §8, D2 §7, **R2 §8**. Do not "fix" any of them.
3. R2's tool loop + executors, the compiler, and the model adapter (the judge is just a model call through it).

## Setup
- Branch `feat/ws-r3-evals` off `main`. **Do not merge to `main` yourself** — leave the merge to Juan (if `main` is missing an expected prerequisite, stop and say so).
- `supabase start && supabase db reset && pnpm seed:auth` (Kong quirk → `docker restart supabase_kong_optiax-crm`).
- Real `GEMINI_API_KEY` in `apps/runtime/.env.local` for `pnpm eval:live` and manual runs; the default test gate uses `FakeModel` only and never hits the network.

## Deliverables (detailed in the spec)
1. §0: real handoff on 4-round ceiling (`needs_attention` + pause) + regression test — its own commit, first.
2. Eval harness driving the real R2 loop with a pluggable model; hermetic/repeatable (rollback or disposable schema) (§1).
3. LLM-judge via the model adapter; `EvalJudgementSchema` in `packages/shared` (§2).
4. 5–10 canned fixtures per vertical covering capture/refusal/escalation/out-of-stock/pause-window/runaway, plus the Q-C and Q-D probes (§3).
5. `evaluateDraft(tenantId)` publish gate; deterministic layer in CI, real-Gemini layer as `pnpm eval:live` outside the default gate (§4).
6. Tests + DoD per §5; probe rates + recommendations in `SESSION_NOTES.md`.

## Hard rules
- Deterministic assertions gate publish and run in CI; **real-Gemini evals never block a normal push** — separate invokable job, documented.
- Service client stays in `src/db/`; evals that touch the DB stay tenant-scoped and hermetic (clean up after themselves).
- New schemas in `packages/shared`; reuse R2/D2 schemas verbatim; no `any`.
- Any compiler change → `COMPILER_VERSION` bump + snapshot update. No new tables expected; if any, `tenant_id` + RLS + grants, isolation/meta green.
- New deps: a lightweight test/eval runner only if the existing vitest setup can't express it — prefer vitest; log any addition.
- Scope: no dashboard publish UI, no campaign evals. For Q-C/Q-D, **measure and recommend — do not build** the fixes; those are follow-ups.

## Definition of done
Spec §5 checklist, all boxes. The gate must block a deliberately-broken draft and pass the seeded good config. End with `SESSION_NOTES.md`: numbered assumptions, how to run both eval layers, Q-C/Q-D rates + recommendations, questions.
