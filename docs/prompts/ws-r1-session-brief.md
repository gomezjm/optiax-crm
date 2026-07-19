# Session brief: Workstream R1 — Coexistence pause, 24h window, operating hours

*(Run only after `feat/phase-1-walking-skeleton` is merged to `main`. Paste everything below into Claude Code at the repo root.)*

---

You are building **workstream R1** of the Optiax WhatsApp CRM runtime: coexistence pause (owner replies from their phone → bot pauses), Meta's 24-hour messaging window, operating hours, and a message-status ordering guard. You extend the existing Phase 1 pipeline — do not restructure it.

## Read first, in this order
1. `docs/specs/ws-r1-coexistence-window.md` — your spec, including explicit non-goals.
2. `docs/specs/phase-1-walking-skeleton.md` §9 addendum + `docs/specs/phase-0-contracts.md` §11 — ratified decisions. **Do not "fix" any of them** (repo-module surface, retry-safe dedupe, envelope parser location, unforced RLS on `profiles`, explicit grants).
3. `docs/session-notes/` — how previous sessions handled ambiguity.

## Setup
- Branch `feat/ws-r1-coexistence` off `main`.
- `supabase start && supabase db reset && pnpm seed:auth`. `apps/runtime/.env.local` has a real `GEMINI_API_KEY` for manual verification; automated tests use `FakeModel` only.

## Deliverables (detailed in the spec)
1. Published-config loading via `getPublishedConfig()` on the tenant repo (§1).
2. Echo handling: parse, persist owner message, set/extend pause (§2).
3. Pause enforcement with lazy re-arm; `paused_until IS NULL` = indefinite (§2).
4. Central `assertWithinWindow` guard in the send path (§3).
5. Operating hours (Intl API, tenant timezone, overnight ranges) + skip-turn recording for every silent-skip path, with `AgentSkipReason` in `packages/shared` (§4).
6. Status monotonic-rank guard (§5).
7. Tests per §6; demo script + `SESSION_NOTES.md` per §7.

## Hard rules
- Isolation + meta-test suites stay green (`pnpm db:test` before declaring done).
- No schema changes expected; if truly needed: **new** migration + `tenant_id` + RLS + explicit grants.
- All echo-payload shape knowledge stays inside `apps/runtime/src/wa/envelope.ts` — the fixture is a reconstruction and will be corrected from captured payloads later; every guessed field gets a `SESSION_NOTES.md` line.
- Types in `packages/shared` (the new `AgentSkipReason` goes there); no redeclaration, no `any`, no new dependencies (no date libraries — `Intl` only).
- Scope discipline: no tools, no audio, no template sending, no dashboard UI, no auto-replies.
- If a ratified decision seems wrong, stop and log it in `SESSION_NOTES.md` — do not change it.

## Definition of done
Spec §7 checklist, all boxes. End with `SESSION_NOTES.md`: numbered assumptions (continue the convention), demo script, questions for the coordinator.
