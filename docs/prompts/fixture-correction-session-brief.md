# Session brief: Fixture correction from captured 360dialog payloads

*(Small session. Run after Phase 1 is merged and real payloads exist in `captures/360dialog/`. Paste everything below into Claude Code at the repo root.)*

---

Real 360dialog **sandbox** webhook payloads have been captured (via `scripts/capture-webhook.ts`, runbook: `docs/runbooks/capture-360dialog-webhook.md`). Your job: make our fixtures, envelope parser, and signature verification match reality. Small, surgical session — no feature work.

## Read first
1. `captures/360dialog/` — the captured payloads (bodies + headers). Ground truth.
2. `packages/shared/fixtures/360dialog/` + its README — current reconstructions.
3. `apps/runtime/src/wa/envelope.ts` — the single home of envelope-shape knowledge.
4. Ratified decisions: `docs/specs/phase-0-contracts.md` §11, `docs/specs/phase-1-walking-skeleton.md` §9.

## Setup
Branch `feat/fixture-capture-correction` off `main`. `supabase start && supabase db reset && pnpm seed:auth` for the integration/db suites.

## Tasks
1. **Diff captured vs fixtures** for every event type captured (inbound text at minimum, statuses if present). Produce a field-by-field table in `SESSION_NOTES.md`: confirmed / corrected / still-unverified.
2. **Correct the fixtures** to the real shapes, preserving our two seed `phone_number_id`s so tests keep working (swap the captured ids for the seed ones; change nothing else about the real structure). Update `fixtures/README.md`: mark each fixture **captured-verified** vs **reconstruction**. `echo-owner-reply.json` and `history-sync.json` stay reconstructions (sandbox cannot produce them — coexistence-only; do not invent "corrections" for them, but note any structural implications the real envelopes suggest).
3. **Update `envelope.ts`** to the corrected shapes. All shape knowledge stays in this one file (ratified P1-Q2; graduation to `packages/shared` stays deferred until the echo shape is also confirmed — note this refinement in `SESSION_NOTES.md`).
4. **Signature scheme**: inspect captured headers. If 360dialog signs sandbox deliveries, implement real verification strictly behind the existing `signWebhookPayload`/`verifyWebhookSignature` seam, keeping `pnpm simulate` working (it signs its own requests). If deliveries are unsigned, keep the HMAC stub for simulate, make the webhook route's behavior explicit via env (`WEBHOOK_VERIFY=stub|360dialog|off` — default `stub`), and log a Phase 4 TODO to confirm against production webhooks. Document whichever reality you find.
5. **Ripple check**: run every suite — compiler snapshots, unit, integration, isolation. Fix breakage caused by shape corrections (test expectations may legitimately change; the pipeline logic should not need restructuring — if it does, stop and flag).

## Hard rules
- No feature work, no schema changes, no new dependencies. Don't touch pause/window logic (that's R1, not yet built).
- Captured files are ground truth — never "improve" them. Redact nothing in fixtures except swapping ids/phone numbers for seed values.
- All suites green before done. `SESSION_NOTES.md` with the diff table, decisions, and questions.

## Definition of done
- [ ] Fixtures corrected + README statuses accurate
- [ ] `envelope.ts` matches captured reality; `pnpm simulate inbound-text` still produces the full Phase 1 flow locally
- [ ] Signature reality documented + implemented per task 4
- [ ] `pnpm typecheck && pnpm test && pnpm db:test` green
- [ ] `SESSION_NOTES.md` diff table: confirmed / corrected / still-unverified fields per event type
