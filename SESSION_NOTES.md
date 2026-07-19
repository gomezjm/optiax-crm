# Phase 1 — Session notes (walking skeleton)

Spec: `docs/specs/phase-1-walking-skeleton.md`. Phase 0 notes moved to
`docs/session-notes/phase-0.md` (all 31 decisions ratified in phase-0 spec §11).

**Status: every §8 DoD box checked, verified live** — full flow ran with real
Gemini locally (`gemini-2.5-flash`, key from `apps/runtime/.env.local`), dedupe
proven (two POSTs → one reply), unknown `phone_number_id` drains with a logged
error, `pnpm typecheck` / `pnpm test` (52) / `pnpm db:test` (221 isolation + 5
integration) all green, import restrictions enforced, `es.json` holds every UI
string, and RLS-scoped Realtime delivery was verified headlessly against the
live stack (signed-in tenant admin received both INSERT events).

## Assumptions & deviations (numbered, same convention as Phase 0)

1. **`src/db/` exports more than the spec's "exactly two things."** Besides
   `resolveTenantByPhoneNumberId` and `createTenantRepo`, the `createDb()`
   surface exposes `webhookEvents` (insert/get/markProcessed/markError — the
   table is tenant-nullable by design, so it can't live behind a tenant repo)
   and `queue` (pgmq send/read/archive — not a tenant table). Without these the
   webhook route and worker cannot exist. The invariant that matters — the raw
   service client never leaves `src/db/` — holds, and is doubly enforced
   (eslint `no-restricted-imports` + `test/import-restriction.test.ts`).
2. **`createDb(opts)` is a factory, not module-level singletons** — the two
   spec'd functions are methods on its return value. Chosen for testability
   (integration tests build their own instance); `src/index.ts` builds exactly
   one.
3. **pgmq is reached through `public.wa_inbound_send/read/archive` RPC
   wrappers** (migration `20260718000700`): PostgREST doesn't expose the `pgmq`
   schema. `security definer`, EXECUTE revoked from anon/authenticated, granted
   to `service_role` only. Same migration adds `messages` to the
   `supabase_realtime` publication (the one expected schema change).
4. **Retry vs dedupe interaction**: a bare "wasDuplicate → skip" would break
   retries — if Gemini fails *after* the inbound row is inserted, every retry
   would see a duplicate and the customer would never get a reply, defeating
   the visibility-timeout retry. On `wasDuplicate` the pipeline checks
   `hasOutboundReplyAfter(conversation, inbound.created_at)`: reply exists →
   true duplicate delivery, skip; no reply → resume the half-done job. Unit +
   integration tests cover both directions.
5. **Meta envelope parsing lives in `apps/runtime/src/wa/envelope.ts`**, not
   `packages/shared`. Rationale: only the runtime parses webhooks, the brief
   said not to touch shared schemas, and the fixtures are reconstructions
   pending captured payloads. Flagged to graduate to shared once real payloads
   confirm the shape. (Not a redeclaration — these types exist nowhere else.)
6. **History mapping for sources the spec didn't list**: `campaign` →
   `assistant` (outbound business content), `system` → skipped (internal
   notices like "Pedido creado…" aren't conversation turns). `template` bodies
   are treated as text.
7. **Non-text non-audio messages (e.g. image) DO get a reply** — the spec only
   exempts audio. The model sees `[imagen] <caption>` placeholder lines.
8. **Audio skip is recorded as an `agent_turn`** with `model: 'none'`, zero
   tokens, `error: { reason: 'audio_not_supported' }`, `message_id` = the
   inbound audio row (spec: "log a skip reason in `agent_turns.error`"). If the
   tenant has no active prompt version the turn can't be written
   (`prompt_version_id` is NOT NULL) — logged to console and skipped.
9. **No active `prompt_version` → persist inbound, skip reply, console log.**
   Not treated as a poison/failure case; R-phases own tenant-misconfiguration
   UX.
10. **Statuses are best-effort per spec**: `wa_status` updated iff a message
    with that `wa_message_id` exists in-tenant; unknown ids ignored silently.
    No ordering guard (a late `delivered` can overwrite `read`) — fine for the
    skeleton, noted for R1.
11. **Missing/garbled envelope (`no phone_number_id`)** → `webhook_events.error
    = { reason: 'no_phone_number_id' }`, archived, queue drains — same terminal
    treatment as unknown tenant.
12. **Terminal failures keep `processed_at` NULL** and set `error` instead;
    success sets `processed_at` and leaves `error` NULL. So: processed ⇒ ok,
    error ⇒ terminal failure, neither ⇒ pending/in-retry.
13. **Poison guard counts pgmq `read_ct`** (delivery attempts), archives after
    the 3rd failed read and records `{ reason: 'poison_message', read_ct,
    error }` on the event row. Malformed queue payloads (no
    `webhook_event_id`) are archived on first sight.
14. **Runtime test split**: unit tests (FakeModel + in-memory `FakeDb`) run in
    `pnpm test` — CI's unit job has no DB. DB-backed integration tests run via
    `pnpm db:test` (root script now appends `test:integration`), so CI's db job
    covers them. The spec's "unit" items needing a DB (tenant resolution,
    dedupe against real constraints) live in the integration suite.
15. **Integration tests create their own service client for assertions** — the
    supabase-js ban is scoped to `src/**` (shipped code). Tests must inspect
    tables the repository deliberately doesn't expose.
16. **Local-dev fallbacks**: with no `.env.local` the runtime defaults to the
    local `supabase start` URL + well-known supabase-demo service key (same
    convention as `scripts/seed-auth.ts`); with no `GEMINI_API_KEY` it boots
    with `FakeModel` and a loud warning instead of crashing. Deploys must set
    everything explicitly.
17. **`GEMINI_MODEL_ID` defaults to `gemini-2.5-flash`** (current stable Flash
    on the v1 API as of this session; `@google/genai` SDK v2.12.0). Override
    via env. Retry: one, on 5xx/abort, 250–750 ms jitter; 30 s hard deadline
    per attempt via `AbortController`.
18. **Dashboard moved to `src/` layout** (`src/app`, `src/lib`, `src/i18n`) to
    match the spec's `apps/dashboard/src/i18n/es.json` path; Next.js supports
    both, middleware sits at `src/middleware.ts`.
19. **`@supabase/ssr` added** for cookie-based auth in App Router — it's the
    official Supabase client helper (allowed under "Supabase clients"); all
    imports of it are fenced into `src/lib/supabase/`.
20. **Inbox snippet strategy**: one extra query for the last ~200 messages of
    the listed conversations, first-per-conversation wins. Avoids N+1 without
    a view/RPC; revisit in D1 if lists grow.
21. **Realtime subscription races on brand-new subscriptions**: an INSERT
    landing within ~1–2 s of `SUBSCRIBED` can be missed (server-side
    subscription settle). Irrelevant for the long-lived inbox subscription;
    worth remembering when writing E2E UI tests.
22. **`seed.sql` untouched; no new tables** — meta-test allowlist unchanged,
    now also asserts every public table grants ≥ SELECT to `authenticated`
    (spec §6 extension).
23. **`pnpm simulate` now defaults to `/webhooks/wa`** (spec §1 route replaces
    Phase 0's `/webhook` stub).
24. **Phase 0 `SESSION_NOTES.md` moved** to `docs/session-notes/phase-0.md` so
    this file can be the Phase 1 handoff (content unchanged).

## Demo script (for Juan)

Terminal 1 — stack + data:

```bash
pnpm i
supabase start
supabase db reset          # migrations (incl. new #7) + seed.sql
pnpm seed:auth             # auth users + compiled prompt_versions
```

Terminal 2 — runtime (real Gemini):

```bash
# apps/runtime/.env.local must contain: GEMINI_API_KEY=<real key>
pnpm --filter @optiax/runtime dev
# expect: "[runtime] model: gemini-2.5-flash" and "[worker] polling wa_inbound"
```

Terminal 3 — dashboard:

```bash
# apps/dashboard/.env.local: NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY from `supabase start`
pnpm --filter @optiax/dashboard dev
```

Browser: `http://localhost:3000` → redirected to `/login` → sign in as
`admin@modavalentina.test` / `password123` → `/inbox` shows the two seeded
Moda Valentina conversations; select **Camila Rojas** (top).

Terminal 4 — fire the webhook:

```bash
pnpm simulate inbound-text
```

Observe, in order:

1. Terminal 2: `[webhook] event … queued (tenant=Moda Valentina)`, then
   `[wa:mock] → 573015550101: <real Gemini reply in Spanish>`.
2. Studio (`http://127.0.0.1:54323`): new rows in `messages` (inbound +
   outbound `source=bot`), `agent_turns` (model/latency/tokens),
   `webhook_events.processed_at` set.
3. Browser: both messages appear **live** in the open thread — no refresh.

Then prove dedupe: run `pnpm simulate inbound-text` again → runtime logs a
processed event but **no** second `[wa:mock]` send, no new rows. And the
failure path: `pnpm simulate inbound-audio` persists the voice note with an
`agent_turns.error = audio_not_supported` and no reply.

Checks: `pnpm typecheck && pnpm test && pnpm db:test` (db:test = isolation
suite + runtime integration suite; needs the Terminal 1 steps done).

## Questions for the coordinator

1. `webhook_events` + queue access had to live in `src/db/` alongside the two
   spec'd exports (assumption 1) — bless this as the canonical repo-module
   surface, or should system stores get their own module boundary in R1?
2. Envelope parser location (assumption 5): graduate to `packages/shared` when
   captured 360dialog payloads land, or keep runtime-local until a second
   consumer exists?
3. `gemini-2.5-flash` as default model — confirm, or pin a different/newer
   Flash for the R-phases (config caching TODO is noted in `GeminiModel`)?
4. Statuses have no ordering guard (assumption 10) — acceptable until R1?
5. Sender interface is `sendText(to, body)` per spec; the outbound row's
   `wa_message_id` stays NULL with the mock. OK that status fixtures therefore
   can't match mock-sent messages until Phase 4's real sender?
