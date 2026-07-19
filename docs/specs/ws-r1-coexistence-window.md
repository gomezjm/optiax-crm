# Workstream R1 — Coexistence pause, 24h window, operating hours

Runtime-only workstream. Makes the agent behave correctly alongside a human owner using the WhatsApp Business app, and respect Meta's messaging rules. Builds directly on the Phase 1 pipeline — extend it, don't restructure it.

Read first: `docs/specs/phase-1-walking-skeleton.md` **including §9 addendum** (ratified decisions — the repo-module surface, retry-safe dedupe, and envelope-parser location are settled; don't revisit). Architecture doc §4 "Owner intervenes" and §5 "24-hour window".

**Not in scope**: agent tools (R2), audio transcription (R2), template-message sending (C2 — outside-window behavior here is *block and log*, not template fallback), dashboard pause toggle UI (D-phase; the schema already supports it), auto-replies (C2).

## 1. Behavior config loading

Runtime behavior flags come from the **published `agent_configs.config`**, parsed with `AgentConfigSchema` from `packages/shared` (the compiled prompt keeps coming from `prompt_versions`). Add `getPublishedConfig()` to the tenant repo; cache per worker iteration, not across messages. Missing/invalid published config → treat like "no active prompt version" (persist inbound, skip reply, console log) — tenant-misconfig UX stays out of scope.

## 2. Coexistence pause (the core of R1)

### Echo handling
`smb_message_echoes` events (fixture: `echo-owner-reply.json`) currently fall through as unhandled. Implement:

1. Parse in `envelope.ts` (shape is a best-effort reconstruction — keep ALL echo-shape knowledge inside `envelope.ts` so the real captured payload is a one-file correction; add a `SESSION_NOTES` line for any field you had to guess).
2. Persist the owner message: `direction: 'outbound'`, `source: 'owner_app'`, idempotent on `wa_message_id` like any message.
3. Set `bot_paused = true`, `paused_until = now() + config.agent.pauseHoursOnOwnerReply` on the conversation. An echo on an already-paused conversation **extends** `paused_until` (owner is still active).
4. Update `last_message_at` (not `last_customer_message_at` — echoes don't open the 24h window).

### Pause enforcement + lazy re-arm
In the inbound pipeline, replace Phase 1's bare `bot_paused` check:

- `bot_paused && paused_until > now()` → persist message, no reply, record an `agent_turn` skip (`error: { reason: 'bot_paused' }` — same pattern as `audio_not_supported`).
- `bot_paused && paused_until <= now()` → **lazy re-arm**: clear the flag (`bot_paused = false`, `paused_until = null`) and process normally. No cron/timer job — expiry is evaluated on the next inbound. Manual dashboard toggle (D-phase) will set `bot_paused = true, paused_until = null` = paused indefinitely; treat `paused_until IS NULL` as *never expires*.

## 3. 24h-window gating

Meta rule: free-form messages only within 24h of the customer's last message. Implement one central guard, not scattered checks:

- `assertWithinWindow(conversation)` in the send path (the only place outbound sends happen). Inbound-triggered replies trivially pass (the inbound just arrived and updated `last_customer_message_at`); the guard exists so **future** callers (campaigns, dashboard composer, R2 tools) inherit enforcement for free.
- Outside window → do not send, record `agent_turn` skip (`reason: 'outside_24h_window'`), log loudly. Template fallback is C2's job.
- Edge: `last_customer_message_at IS NULL` (no customer message ever) → outside window.

## 4. Operating hours + master toggle

Evaluate before generating a reply (after persisting the inbound):

- `config.agent.operatingMode`: `'always'` → active. `'schedule'` → active only inside `schedule.days`/`start`/`end` evaluated in the **tenant's timezone** (`tenants.timezone`, IANA name). `'outside_hours'` → active only *outside* the schedule (owner handles chats during business hours; bot covers nights/weekends).
- Implement timezone math with the `Intl` API (no date library — we agreed no heavy deps). Handle: overnight ranges (`start > end`, e.g. 22:00–06:00), day boundaries in tenant-local time.
- Inactive → persist, skip reply, `agent_turn` skip (`reason: 'outside_operating_hours'`).
- `tenants.agent_enabled = false` (already checked in Phase 1) → keep, but now also record the `agent_turn` skip (`reason: 'agent_disabled'`) instead of silent skip.

Skip-reason enum (canonical, in `packages/shared` as `AgentSkipReason`): `'bot_paused' | 'outside_operating_hours' | 'outside_24h_window' | 'agent_disabled' | 'audio_not_supported' | 'no_active_prompt'`. Migrate Phase 1's existing reasons to it. (Zod/TS only — `agent_turns.error` stays jsonb; no migration needed.)

## 5. Status ordering guard (ratified P1-Q4)

Monotonic rank on `wa_status` updates: `accepted(0) < sent(1) < delivered(2) < read(3)`; update only if incoming rank > stored rank. `failed` is terminal-recordable from any state and never downgraded. Pure function + unit tests; applied where Phase 1 handles `statuses[]`.

## 6. Tests

- Unit: schedule evaluation (normal + overnight ranges, `America/Bogota` vs `UTC`, all three modes), pause arithmetic (extend on second echo, lazy re-arm at expiry, `NULL` = indefinite), window guard (inside/outside/never-messaged), status rank matrix, skip-reason recording.
- Integration (local Supabase, FakeModel): echo fixture → owner message row + `bot_paused` + `paused_until` set; inbound during pause → persisted, no reply, skip turn recorded; inbound after expiry → flag cleared + real reply; echo idempotency (same echo twice → one row, one pause).
- Isolation + meta-test suites stay green. No schema changes expected; if one becomes necessary: new migration, `tenant_id`, RLS, grants.

## 7. Definition of done

- [ ] Live demo: `pnpm simulate echo-owner-reply` pauses the conversation (visible in Studio), next `inbound-text` gets no reply with a `bot_paused` skip turn; after manually expiring `paused_until` in Studio, `inbound-text` gets a real Gemini reply and the flag clears
- [ ] All unit + integration + isolation tests green; `pnpm typecheck` clean
- [ ] `AgentSkipReason` exported from `packages/shared`; every silent-skip path from Phase 1 now records a turn
- [ ] All echo-shape guesses flagged in `SESSION_NOTES.md`
- [ ] `SESSION_NOTES.md` with assumptions, demo script, questions
