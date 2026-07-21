# WS-R3 — Session notes (Agent evals + publish gate)

Spec: `docs/specs/ws-r3-evals.md`. Branch `feat/ws-r3-evals` off `main`.
Previous sessions' notes live in `docs/session-notes/` (R2's moved there this
session, same convention as Phase 0/1, R1, D1, D2).

Ratified inputs honoured as law: phase-0 §11, phase-1 §9, R1 §8, D2 §7, **R2 §8**.
Nothing in those was "fixed". `main` contained R2 (the prerequisite) — no missing
merge this time.

---

## 0. §0 handoff fix landed first (its own commit)

`fix(ws-r3): round-limit ceiling performs a real handoff`. The 4-round tool-loop
ceiling used to send `escalation.handoffMessage` but never set `needs_attention`
or pause the bot — it promised a human and summoned none (ratified R2 Q-E defect).
The ceiling path now performs the same handoff `handoff_to_human` does:
`needs_attention = true` + indefinite pause (`paused_until = null`), done **before**
the send/marker logic so it holds even with no configured handoff message. The
last `agent_turn` of a ceiling-hit loop carries `error: { reason: 'round_limit_handoff' }`
(a free-form marker in the jsonb, deliberately *not* an `AgentSkipReason` — tools
ran, so it is not a skip). Regression tests: unit (`pipeline-tools.test.ts`) and
integration (`integration/tools.test.ts`, real Postgres) assert a ceiling-hit
conversation ends `needs_attention = true` + paused with the turn marked. This is
also eval case §3's "runaway loop".

---

## 1. Numbered assumptions

Everything below was decided in-session. Ratify, correct, or park each.

1. **Hermeticity mechanism: a fresh in-memory `EvalDb` per fixture, not a
   real-Supabase scratch tenant.** The spec offered "transaction rollback / a
   disposable schema / a scratch-or-seeded tenant — pick one, keep hermetic". I
   picked a per-run in-memory tenant repo (`apps/runtime/src/evals/eval-db.ts`)
   because: (a) it is the strongest hermeticity — nothing to tear down, zero
   cross-case bleed; (b) it keeps the deterministic layer **network-free**, so it
   runs in the default `pnpm test` gate exactly as the hard rule demands; (c) it
   still drives the **real** pipeline, tool loop, executors and compiler — only
   storage is faked, and it mirrors the real repo's tenant-scoping + catalog
   tokenisation/ranking (both vetted in R2). supabase-js/PostgREST has no
   interactive transactions, so true rollback was not available anyway. The
   harness is **DB-pluggable** (`evaluateSuite`/`evaluateDraft` take/produce a
   `RuntimeDb`), so backing it with a real disposable tenant later is a swap that
   does not touch the gate logic. The service client stays untouched in `src/db/`.

2. **Fixtures are self-contained (own catalog + reference config), not coupled to
   `seed.sql`.** Each suite (`packages/shared/src/evals/{retail,food}.ts`) carries
   its own product ids, prices, availability and a known-good `AgentConfig`. So
   fixtures are decoupled from seed UUIDs and reproducible in isolation. Product
   ids are fixture-owned uuids (`ee0000…` scheme) referenced directly by scripted
   `create_order` calls.

3. **Fixtures live in `packages/shared/src/evals/`, exposed via the
   `@optiax/shared/evals` subpath.** The spec said `packages/shared/evals/`; I put
   them under `src/evals/` so they compile with the package and import cleanly
   (typed) from the runtime and, later, D3 — and behind a subpath (not the root
   barrel) so eval data never enters the dashboard bundle. Trivial path deviation,
   flagged here.

4. **Deterministic layer = FakeModel scripted turns; the judge is stubbed there.**
   The gate blocks on **deterministic checks** (hard fails); judge scores are
   thresholds-with-margin and only meaningful against a real model. In the default
   gate the judge is a `FakeModel` returning `{"score":5,…}` — this still exercises
   the judge plumbing + `EvalJudgementSchema`. Real judging happens in `eval:live`.

5. **`eval:live` is a non-blocking reporting job, and never gates.** The
   deterministic checks are script-shaped; the real model legitimately diverges
   (more turns, asks for size per the retail template, is cautious under
   `confirmBeforeCreate`), so a hard fail there would be noise. `pnpm eval:live`
   prints judge scores + probe rates and always exits 0. Only `pnpm eval` (and
   `pnpm test`) gate.

6. **`evaluateDraft(tenantId)` loads the tenant's *draft* config** via a new
   `TenantRepo.getDraftConfig()` (mirrors `getPublishedConfig`, `status='draft'`),
   picks the suite from `config.business.vertical`, and runs the deterministic
   layer. It only *reads* the draft; each fixture executes against its own
   in-memory `EvalDb`, so the gate never mutates tenant data. Throws when there is
   no valid draft to evaluate.

7. **The judge transcript is the persisted customer/agent messages only** (via
   `toModelHistory`), no other PII (spec §2). Judge output is validated by
   `EvalJudgementSchema` (`{score:1–5, rationale}`); a non-JSON or off-schema reply
   throws rather than silently passing.

8. **No compiler change → no `COMPILER_VERSION` bump. No new tables.** Isolation +
   meta suites unchanged and green.

---

## 2. How to run both eval layers

Prereqs for the live layer only: a real `GEMINI_API_KEY` in
`apps/runtime/.env.local`. The deterministic layer needs nothing but the repo.

```bash
# Deterministic gate (FakeModel, no network) — this is what CI runs.
pnpm eval               # both verticals
pnpm eval retail        # one vertical
pnpm test               # includes the deterministic eval layer (apps/runtime/test/evals.test.ts)

# Real-Gemini layer — manual/nightly, NEVER in the default gate. Reporting only.
pnpm eval:live          # judge scores for every case + Q-C/Q-D probe rates
pnpm eval:live food     # one vertical

# The publish gate D3 calls (loads the tenant's draft from Postgres):
#   evaluateDraft(tenantId)  — exported from @optiax/runtime src/evals
# Proven end-to-end in apps/runtime/test/integration/evals.test.ts (db:test).
```

`evaluateDraft` returns `{ pass, vertical, cases }`; each case carries per-check
pass/fail, the judge `{score, rationale}`, token counts, and the transcript — the
observability D3's "what broke" view needs (spec §4, arch §5).

**Cost/latency note (live layer):** one `eval:live` over both suites is ~18 gated
cases + 4 probes × 5 repeats ≈ 40+ Gemini calls (multi-round cases cost several
each). It took a few minutes wall-clock on `gemini-2.5-flash`. Keep it out of the
per-push path; a nightly is the right cadence.

---

## 3. Q-C and Q-D probe rates + recommendations

Measured with `pnpm eval:live`, `gemini-2.5-flash`, **n = 5 runs per probe per
vertical** (small sample — rates are indicative, not tight). Re-run for firmer
numbers before acting.

### Q-C — quote, then "confirmo" a message later (routed from R2 §8-C)

| vertical | re-called `check_catalog` in msg 2 | order closed in msg 2 |
|---|---|---|
| retail | 1/5 (20%) | 0/5 |
| food   | 2/5 (40%) | 0/5 |

**Reading it.** The R2 question was "how often does the model lose the
`product_id` and have to re-`check_catalog`?" Answer: **not often** — 20–40%. When
it does re-check it recovers fine (the error-text steering from R2 works). The
striking number is order-closed **0/5**: the model almost never fires
`create_order` on the second message — but that is **not** id-loss. It is
`confirmBeforeCreate` caution: on "confírmame ese" the model recaps the order and
asks for one more explicit yes, deferring the write a turn. That is arguably
*correct* behaviour, not a bug.

**Recommendation: keep (i) — always-fresh tool results.** The id-recall fumble
that (ii) persisted-summaries or (iii) name-resolving `create_order` would fix is
a minority event (≤40%) that already self-heals via re-check. The dominant
"didn't order yet" effect is a confirmation-flow artifact those options would not
touch. If we later want to cut the extra turn, the cheaper lever is prompt/flow
(let an explicit "confirmo/sí" after a recap satisfy `confirmBeforeCreate`), not
result persistence. Revisit only if a larger sample pushes the re-check rate
materially higher.

### Q-D — payment-receipt image on an open `awaiting_payment` order (routed from R2 §8-D)

| vertical | escalated (`handoff_to_human`) |
|---|---|
| retail | 5/5 (100%) |
| food   | 5/5 (100%) |

**Reading it.** With a payment-proof `payment_proof` escalation rule configured
and the receipt caption visible to the model, it escalated **every time**.

**Recommendation: do NOT build the scoped-deterministic rule now.** R2 §8-D
already ruled out a blanket image→handoff (over-fires on product photos) and
parked the narrower "image + open `awaiting_payment` order → deterministic
handoff" as a candidate. The measured under-escalation rate is **0%** here, so the
model-decided path is sufficient; a deterministic rule buys nothing today and adds
surface area. Keep it parked. Caveat: n=5 and the caption was explicit ("comprobante
de la transferencia"); a receipt sent with no caption, or on a conversation whose
awaiting_payment order is stale, could escalate less — worth a targeted re-measure
if payment-proof handling becomes a priority.

---

## 4. Definition of done (spec §5)

- [x] §0 handoff fix landed first, its own commit, regression test green (unit + integration).
- [x] `pnpm test` / `pnpm db:test` green **including** the deterministic eval layer;
      `pnpm eval:live` runs the real-Gemini suite on demand and is excluded from the default gate.
- [x] Both verticals have 5–10 fixtures (retail 10, food 8); the gate blocks a
      deliberately-broken draft (orders-disabled and dropped-capture-field cases)
      and passes the seeded good config — proven in-memory and against a real
      Postgres draft.
- [x] `evaluateDraft` exposed for D3 (typed, `@optiax/runtime` `src/evals`);
      `EvalJudgementSchema` in `packages/shared`.
- [x] Q-C and Q-D probe rates reported above, each with a recommendation.
- [x] Isolation + meta suites green; no new tables; `COMPILER_VERSION` unchanged
      (compiler untouched).
- [x] This file: numbered assumptions, how to run both layers, probe rates, questions.

Full suite status: `pnpm test` 332 passed; `pnpm db:test` green (isolation/meta +
runtime integration incl. gate tests + dashboard db); `pnpm typecheck` + `pnpm lint` clean.

---

## 5. Questions for ratification

1. **Assumption 1 (in-memory hermeticity) vs. a real disposable tenant.** I
   optimised for a fast, network-free default gate. If you want the gate to also
   catch RLS/grant/trigger regressions end-to-end, I can add a real-Supabase
   disposable-tenant backing behind the existing pluggable seam (deterministic
   layer would then move to `db:test`). Which do you want as the canonical gate?

2. **Assumption 3 (fixtures under `src/evals`, `@optiax/shared/evals` subpath).**
   Confirm the subpath location, or do you want them at the literal
   `packages/shared/evals/` path from the spec (needs a build/exports tweak)?

3. **Q-C recommendation (keep (i)).** Agree to close R2 §8-C on "keep (i)", or
   re-measure with a larger n before deciding? The 0/5 order-close is a
   `confirmBeforeCreate` artifact, not id-loss — flagging in case you'd rather I
   file the prompt/flow tweak as the real follow-up instead.

4. **Q-D recommendation (don't build the rule).** Agree to keep the scoped
   image+awaiting_payment→handoff rule parked given 0% under-escalation, or
   re-measure the no-caption / stale-order variants first?

5. **Judge thresholds for a nightly.** `eval:live` currently reports scores and
   exits 0. If you want the nightly to *alert* on regression, I can add a
   judge-average threshold per suite — out of scope here (no gating on real
   Gemini), so left as a follow-up.
