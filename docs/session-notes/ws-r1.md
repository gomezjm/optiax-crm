# WS-R1 — Session notes (coexistence pause, 24h window, operating hours)

Spec: `docs/specs/ws-r1-coexistence-window.md`. Branch `feat/ws-r1-coexistence`
off `main`. Previous sessions' notes live in `docs/session-notes/` (the
fixture-correction notes moved there from this file, same convention as
Phase 0/1).

**Status: every §7 DoD box checked, verified live** — `pnpm simulate
echo-owner-reply` paused the seeded Camila Rojas conversation (`bot_paused`,
`paused_until = now()+24h` per Moda Valentina's published config); the next
`inbound-text` was persisted with **no** reply and an `agent_turns` skip row
(`model: 'none'`, `error: { reason: 'bot_paused' }`); after manually expiring
`paused_until`, the same `inbound-text` re-armed the flag (`bot_paused=false`,
`paused_until=null`) and got a real `gemini-2.5-flash` reply (1489 ms).
`pnpm typecheck` / `pnpm lint` / `pnpm test` (94) / `pnpm db:test` (221
isolation + 9 integration) all green. `AgentSkipReason` exported from
`packages/shared`. No schema changes, no new dependencies.

## Echo-shape guesses (all inside `apps/runtime/src/wa/envelope.ts`)

The `smb_message_echoes` fixture is a reconstruction (the sandbox cannot emit
echoes — fixtures/README.md), so every extracted path below is a guess to
re-verify when a coexistence number is onboarded:

- E1. Echoes arrive under `value.message_echoes[]` (array key) inside a change
  with `field: 'smb_message_echoes'`. The parser keys off the array, not the
  `field` string.
- E2. Each echo carries `id` (wamid), `from` (business number), `to` (customer
  wa_id), `timestamp`, `type`, and `text.body` — mirroring inbound `messages[]`.
  The parser requires only `id` + `to`; `from` and `timestamp` are ignored
  (`from` is redundant with `metadata.phone_number_id`; we timestamp rows with
  our own insert time, consistent with Phase 1 inbound handling).
- E3. Media echoes are assumed to carry captions the same way inbound media
  does (`{type}.caption`) — same `extractBody` used for both.
- E4. `metadata.phone_number_id` is assumed present on echo changes like on
  every captured change type.
- E5. Real echoes likely carry `user_id`-style fields (per the captured
  inbound/status payloads) — ignored, treated as optional, like everywhere else.

## Assumptions & decisions (numbered, continuing the convention)

1. **Echo on an indefinitely-paused conversation leaves `paused_until` NULL.**
   Spec says an echo "extends" the pause, but overwriting NULL (= never
   expires, the D-phase manual toggle) with `now()+24h` would *shorten* it.
   Indefinite wins; the owner message is still persisted.
2. **Echo idempotency vs retry-safety** mirrors Phase 1's decision 4: a
   duplicate echo on an already-paused conversation is a redelivery → no-op (no
   re-extension); a duplicate on an *unpaused* conversation is a retry after a
   mid-echo failure (row landed, pause didn't) → the pause is set. Covered by
   unit + integration tests.
3. **Missing/invalid published config on the echo path still pauses**, using
   the schema default 24h (`DEFAULT_PAUSE_HOURS` in `pipeline.ts`). §1 only
   defines missing-config behavior for the reply path; coexistence correctness
   shouldn't depend on config validity.
4. **Missing/invalid config on the reply path records skip reason
   `no_active_prompt`** — the spec says "treat like no active prompt version"
   and the canonical enum has no dedicated value. Flagged as a question below.
5. **Skip turns cannot be recorded when the tenant has no active prompt
   version** (`agent_turns.prompt_version_id` is NOT NULL — Phase 1 assumption
   8): those paths log to console only. So "every silent-skip path records a
   turn" holds whenever a turn *can* exist. Avoiding the alternative (a
   migration making the column nullable) kept R1 schema-free.
6. **Operating-hours semantics**: ranges are half-open `[start, end)`
   (07:00–16:00 is active 07:00:00–15:59:59 local); `start === end` is a
   zero-width range (never in schedule); overnight ranges (`start > end`)
   belong to the day the shift *starts* (Mon 22:00–06:00 = Mon 22:00–24:00 +
   Tue 00:00–06:00).
7. **`operatingMode: 'outside_hours'` with no `schedule`** (the schema's
   `superRefine` only requires a schedule for `'schedule'` mode) → nothing is
   ever "inside hours", so the agent stays active around the clock. Question
   below on whether the shared schema should require it.
8. **Invalid tenant timezone fails open**: if `Intl` rejects
   `tenants.timezone`, the pipeline logs loudly and treats the agent as active
   rather than throwing (which would retry → poison the message for a
   permanent misconfig).
9. **Window boundary is strict**: exactly 24h since
   `last_customer_message_at` → outside. `NULL` (never messaged) and
   unparseable timestamps → outside (fail closed). Constants and guard in
   `src/wa/window.ts`.
10. **The window guard sits immediately before the `WaSender` call** (the one
    send site), per §3's "in the send path". The model call happens first —
    harmless today because inbound-triggered replies trivially pass; a blocked
    send records `outside_24h_window` and logs `BLOCKED SEND`. Exercised via
    the retry-of-a-stale-inbound unit test.
11. **Status rank guard lives in `repo.updateMessageWaStatus`** (select
    current → pure `shouldRecordStatus` from `src/wa/status-rank.ts` → update).
    The select→update pair is not atomic; a concurrent writer could interleave.
    Accepted: one single-loop worker, per-message statuses arrive serially.
12. **`TenantContext` gained `timezone`** (repo-surface extension, not a
    restructure) — operating hours need it and the tenant row is already
    loaded there.
13. **Published config is loaded lazily, at most once per webhook event**
    ("cache per worker iteration, not across messages" — one event = one
    worker iteration; the cache dies with the event).
14. **`getPublishedConfig()` returns `AgentConfig | null`**, collapsing
    "missing" and "fails `AgentConfigSchema`" — both are treated identically
    (§1) and the seed validates configs loudly in `seed:auth`.
15. **`FakeDb`'s clock is now anchored to `Date.now()`** (was fixed at
    2026-07-18): the window guard compares row timestamps against the real
    clock, so a frozen past date would have started failing spuriously once
    >24h stale.
16. **`vitest.integration.config.ts` sets `fileParallelism: false`** — the two
    integration files share one seeded DB (queue reads, `webhook_events`
    counts) and must not interleave.
17. **Integration tests isolate on a dedicated customer number**
    (`573015559901`), produced by value-level find/replace on the raw fixture
    JSON (customer number + a `wamid.*` regex) — no echo-payload *paths* leak
    outside `envelope.ts`.
18. **`AgentSkipReason` ships as a Zod enum + const array**
    (`packages/shared/src/schemas/agent-skip-reason.ts`); `agent_turns.error`
    stays free-form jsonb, `{ reason }` is the convention (per spec §4 — no
    migration).
19. **`apps/runtime/CLAUDE.md` updated** — its "don't add pause/24h logic"
    bullet described the pre-R1 state; it now points at the R1 modules and
    repeats the envelope-locality and central-window-guard rules.
20. **`history-sync` events remain unhandled** (fall through, event marked
    processed with no rows) — contact/history import is not in any R1
    deliverable; noted so nobody mistakes it for an oversight.

## Demo script (for Juan)

Terminal 1 — stack + data:

```bash
pnpm i
supabase start
supabase db reset          # migrations + seed.sql
pnpm seed:auth             # auth users + validated configs + compiled prompts
```

(If `seed:auth` fails right after a reset with a bare `{}`: the auth container
restarted and Kong is holding a stale upstream — `docker restart
supabase_kong_optiax-crm`, wait ~5 s, retry. Hit this once during the session.)

Terminal 2 — runtime (real Gemini):

```bash
# apps/runtime/.env.local must contain: GEMINI_API_KEY=<real key>
pnpm --filter @optiax/runtime dev
```

Terminal 3 — the R1 flow:

```bash
pnpm simulate echo-owner-reply
```

Studio (`http://127.0.0.1:54323`) → `conversations`, Camila Rojas row
(`aa000000-0030-…0001`): `bot_paused = true`, `paused_until ≈ now()+24h`,
`last_message_at` updated, `last_customer_message_at` untouched. `messages`
has the owner's text as `direction=outbound, source=owner_app`. Terminal 2
logs `owner echo → bot paused conv=… until …`. No model call.

```bash
pnpm simulate inbound-text
```

Terminal 2: `skip reply (bot_paused)`. Studio: the customer message row exists,
**no** bot reply, and `agent_turns` gained a row with `model='none'`,
`error={"reason":"bot_paused"}`. Re-run `pnpm simulate echo-owner-reply` here
to see idempotency: one owner row, `paused_until` unchanged.

Expire the pause (Studio SQL editor):

```sql
update conversations set paused_until = now() - interval '1 minute'
where id = 'aa000000-0030-4000-8000-000000000001';
```

```bash
pnpm simulate inbound-text
```

Terminal 2: `pause expired → re-armed conv=…` then a real `[wa:mock] → …`
Gemini reply. Studio: `bot_paused=false`, `paused_until=null`, outbound
`source=bot` row, `agent_turns` row with real model/latency/tokens.

Checks: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:test`
(db:test needs Terminal 1's steps done).

## Questions for the coordinator

1. Missing/invalid published config records skip reason `no_active_prompt`
   (assumption 4). Fine, or add a dedicated `no_published_config` value to
   `AgentSkipReason` in a follow-up?
2. `outside_hours` mode with no schedule = agent always active (assumption 7).
   Should `AgentConfigSchema.superRefine` require `schedule` for
   `outside_hours` too? (Shared-schema change + seed review — out of R1 scope,
   didn't touch.)
3. Echo on an indefinitely-paused conversation never downgrades the pause to
   finite (assumption 1) — confirm before the D-phase pause-toggle UI relies
   on it.
4. Skip paths on tenants with no active prompt version stay console-only
   (assumption 5). Acceptable long-term, or should a future migration make
   `agent_turns.prompt_version_id` nullable so misconfigured tenants still get
   observable turns?
5. The echo path pauses with the 24h default when the config is
   missing/invalid (assumption 3) — confirm that's preferred over "no config,
   no pause".
