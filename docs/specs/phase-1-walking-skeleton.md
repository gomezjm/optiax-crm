# Phase 1 — Walking skeleton

One thin end-to-end slice, real at every integration point that exists locally:

```
pnpm simulate inbound-text
  → runtime verifies signature → logs webhook_events → enqueues pgmq
  → worker: resolve tenant by phone_number_id → dedupe wa_message_id
  → load/create conversation + customer → load active prompt_version + last 20 messages
  → REAL Gemini call → persist inbound + outbound messages + agent_turn
  → (send via mocked 360dialog sender)
  → reply visible in a bare inbox page, live via Supabase Realtime
```

This is the reference implementation every later session copies patterns from — structure matters more than features. Precondition: `feat/phase-0-contracts` merged to `main`; branch from there.

**Not in scope** (later workstreams own these): pause/echo handling and 24h-window gating (R1) — but DO check `bot_paused`/`agent_enabled` flags and skip the reply if set (persist the message regardless; R1 owns *setting* the flags). No function calling/tools (R2), no audio transcription (R2 — audio messages get persisted, no reply, log a skip reason in `agent_turns.error`), no operating-hours logic (R1), no configurator/playground UI (D3), no real WhatsApp sending.

## 1. Runtime (`apps/runtime`)

Hono app + worker in one process for now (`pnpm dev` starts both; separable later per scaling path).

- `POST /webhooks/wa`: verify `x-webhook-signature` (shared `verifyWebhookSignature`) → insert `webhook_events` row (tenant resolved best-effort, nullable) → `pgmq.send` to `wa_inbound` (payload: webhook_event id) → 200 within ms. Invalid signature → 401, nothing stored.
- `GET /health`: 200 + `{ version }`.
- Worker: poll `wa_inbound` (visibility timeout 60s). Parse Meta envelope from the stored `webhook_events` row. Per message: the pipeline above. Success → archive + set `processed_at`. Failure → retry via visibility timeout; after 3 reads, archive + record error in `webhook_events.error` (poison-message guard). Statuses (`statuses[]`) in this phase: update `messages.wa_status` if the message exists, else ignore.

### The tenant-scoped repository module — the load-bearing pattern

`apps/runtime/src/db/` is the **only** place the service-role client is created. It exports exactly two things: `resolveTenantByPhoneNumberId(phoneNumberId)` (the one legitimately tenant-less query) and `createTenantRepo(tenantId)` — every method inside it hard-scopes `tenant_id`. The raw client is module-private, never exported, no exceptions. Add an eslint `no-restricted-imports` rule (or unit test greping imports) so nothing else imports `@supabase/supabase-js` in the runtime. Every later runtime session inherits this; it's the coded enforcement of the CLAUDE.md rule.

Repo methods needed this phase: get/create conversation by `wa_id` (also creating a minimal `customers` row, `source: 'agent'` — provenance is explicit per spec §11), get active prompt version, insert message (idempotent on `wa_message_id` conflict → return existing + `wasDuplicate` flag), list last N messages, insert `agent_turn`, update conversation timestamps (`last_message_at`, `last_customer_message_at`).

## 2. Model adapter (`apps/runtime/src/model/`)

Provider-agnostic interface — the runtime never sees Gemini payload shapes:

```ts
interface AgentModel {
  generateReply(input: {
    systemPrompt: string;
    history: Array<{ role: 'user' | 'assistant'; text: string }>;
  }): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number; latencyMs: number }>;
}
```

`GeminiModel` implements it: `GEMINI_API_KEY` + `GEMINI_MODEL_ID` (default a current Flash model) from env; one retry on 5xx/timeout with jitter; hard 30s deadline. `FakeModel` (returns canned text) for all automated tests — real Gemini is exercised manually, never in CI. Use Google's official `@google/genai` SDK (the one current as of implementation — check, don't assume). No context caching yet (note as TODO for R-phase; it needs stable prompt identity plumbing).

History mapping: `messages` → roles: `customer` → `user`; `bot`/`owner_app`/`dashboard` → `assistant`. Skip non-text messages (placeholder line `[imagen]`/`[audio]` so the model has continuity).

## 3. WhatsApp sender (`apps/runtime/src/wa/`)

```ts
interface WaSender { sendText(to: string, body: string): Promise<{ waMessageId: string | null }>; }
```

`MockWaSender` (default; logs + returns null id) — env `WA_SENDER=mock|360dialog`; the real implementation is a Phase 4 task, only the interface is fixed now. Outbound message rows: `direction: 'outbound'`, `source: 'bot'`, `wa_status: 'accepted'`.

## 4. Dashboard (`apps/dashboard`)

Minimal but structurally correct — this is the template for all D-workstreams:

- Supabase auth: email/password login page; middleware-guarded `/inbox`; sign-out.
- `/inbox`: left pane — conversations ordered by `last_message_at` (name/wa_id + snippet); right pane — selected thread, messages styled by `source` (customer left; bot/owner right, visually distinct). Supabase Realtime subscription on `messages` for the selected conversation (enable realtime for the table via migration if not already). No composer (sending from dashboard is a later feature).
- **i18n pattern set here**: `apps/dashboard/src/i18n/es.json` + a tiny typed `t('inbox.title')` helper (no library yet — revisit in D1; keys structured per screen). Zero hardcoded UI strings — this is what later sessions copy.
- Reads via the user's Supabase client only (RLS does the scoping — no service key anywhere in the dashboard, enforce with the same import-restriction trick).

## 5. Config & env

- `apps/runtime/.env.example`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL_ID`, `WEBHOOK_SECRET`, `WA_SENDER`, `PORT`.
- `apps/dashboard/.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `.env*` gitignored except `.env.example`. Local values come from `supabase start` output.

## 6. Tests

- Unit (FakeModel throughout): tenant resolution (known/unknown `phone_number_id`), dedupe (same fixture twice → one inbound row, one reply), history mapping, paused/disabled skip paths, poison-message path.
- Integration (vitest, local Supabase, FakeModel): boot app in-process → POST `inbound-text.json` signed → drain worker once → assert `webhook_events`, `messages` (in+out), `agent_turns`, conversation timestamps. Repeat POST → no duplicates.
- Isolation suite untouched and green. Meta-test still passes (no new tables expected; if you add one, it gets `tenant_id` + RLS **+ explicit grants** — see phase-0 spec §11 migration-6 note).
- **Extend the meta-test**: every `public` table (same allowlist) must have at least SELECT granted to `authenticated`. This catches the Postgres-17 fail-closed mode where a future table ships with RLS but no grants and clients silently see nothing.

## 7. Demo script (goes in `SESSION_NOTES.md`)

Exact commands for Juan: terminals for `supabase start`/db reset+seed, runtime with real `GEMINI_API_KEY`, dashboard; then `pnpm simulate inbound-text` and what to observe (reply in terminal, row in Studio, live update in `/inbox` logged in as `admin@modavalentina` seed user).

## 8. Definition of done

- [ ] Full flow works with real Gemini locally (demo script verified end-to-end)
- [ ] `pnpm simulate inbound-text` twice → exactly one reply (dedupe proven)
- [ ] Unknown `phone_number_id` fixture → event logged with error, no crash, queue drains
- [ ] All tests green in CI (FakeModel), isolation suite green
- [ ] No file outside `apps/runtime/src/db/` imports supabase-js in the runtime; dashboard has no service key
- [ ] `es.json` holds every UI string
- [ ] `SESSION_NOTES.md` with assumptions + demo script
