# Technical Architecture — WhatsApp CRM + AI Sales Agent SaaS

**Stack decision summary:** Supabase (data + auth) · 360dialog (WhatsApp BSP) · Gemini API (agent intelligence) · Next.js on Vercel (frontend) · TypeScript runtime on Railway/Cloud Run (backend hot path) · n8n (cold-path automation)

---

## 1. High-level diagram

```
                        ┌─────────────────────────────┐
                        │   Client dashboard (SaaS)   │
                        │   Next.js on Vercel         │
                        │   - Agent configurator      │
                        │   - CRM inbox & leads       │
                        │   - Test playground         │
                        └──────────┬──────────────────┘
                                   │ Supabase JS client (RLS)
                                   ▼
┌──────────────┐  webhooks  ┌─────────────────┐   reads/writes   ┌────────────────┐
│  360dialog   │──────────▶│  Runtime service │◀────────────────▶│    Supabase     │
│  (BSP layer) │◀──────────│  TypeScript      │                  │  Postgres+Auth  │
│  Cloud API   │  send msg │  Railway/CloudRun│                  │  RLS + pgmq     │
└──────┬───────┘           └────────┬─────────┘                  └────────────────┘
       │                            │ per-message call
       ▼                            ▼
  End customer               ┌─────────────┐        ┌──────────────────────┐
  (WhatsApp app)             │ Gemini API  │        │  n8n (cold paths)    │
                             │ (agent brain)│        │  onboarding, alerts, │
                             └─────────────┘        │  reports, templates  │
                                                    └──────────────────────┘
```

---

## 2. Components and technology choices

### Frontend — Next.js (App Router) + Tailwind + shadcn/ui, hosted on Vercel
- One codebase, two surfaces: marketing/onboarding pages and the authenticated client dashboard.
- Talks **directly to Supabase** (Auth + Postgres with Row Level Security) for all CRM reads: inbox, leads, settings. No custom API needed for CRUD.
- The **agent configurator** is a wizard editing structured JSON config (never raw prompts): vertical selection, business info, tone, products/prices, FAQs, capture fields, escalation rules.
- **Playground**: embedded test chat that calls the runtime service in "draft mode" against unpublished config.
- Embeds **360dialog's partner-hosted Embedded Signup** (with coexistence QR flow) for WhatsApp connection.
- Why Next.js/Vercel: fastest path for a solo builder, first-class Supabase integration, free tier covers early stage, Spanish/English i18n straightforward.

### Backend hot path — stateless TypeScript service (Hono or Fastify) on Railway or Cloud Run
- Single multi-tenant service handling **every inbound WhatsApp message for all clients**.
- Responsibilities: webhook verification → enqueue → tenant resolution by `phone_number_id` → load prompt + conversation state → Gemini API call with function-calling tools → send reply via 360dialog → persist messages/leads.
- Handles the **coexistence pause logic**: `smb_message_echoes` webhook flips `bot_paused` on the conversation; timer re-arms it.
- Why not Supabase Edge Functions for this: Edge Functions work for the webhook *receiver*, but the agent loop (multi-second LLM calls, retries, tool execution) fits better in a long-running service with a queue. Railway = simplest ops; Cloud Run = better scale-to-zero economics later. Either works; pick Railway to start.

### Queue — pgmq (Postgres-native, inside Supabase)
- Decouples webhook receipt (must respond to 360dialog in <10s) from agent processing (can take 5–15s).
- Gives you retries, ordering per conversation, and idempotency (dedupe on WhatsApp message ID).
- pgmq keeps everything in one system; move to Upstash Redis/QStash only if throughput demands it.

### Supabase — system of record
- **Postgres**: all tenant, config, conversation, and lead data (schema below).
- **Auth**: client logins for the dashboard; RLS ensures each tenant sees only their rows.
- **Storage**: media files (customer-sent images, product photos).
- **Realtime**: live inbox updates in the dashboard (new message appears without refresh).

### 360dialog — WhatsApp layer
- Partner Hub / Partner API for multi-tenant channel management.
- Partner-hosted Embedded Signup with coexistence (QR scan, contact + 6-month history import).
- Webhooks: inbound messages, status updates, `smb_message_echoes` (owner replies from app), history/contact sync events.
- Billing: flat monthly per-channel license, Meta message rates passed through at cost.

### Gemini API — agent intelligence
- Called per message with: compiled system prompt (tenant's version) + conversation history + function declarations.
- **Function calling** (declarations generated from tenant config): `capture_customer`, `create_order`, `check_catalog`, `handoff_to_human`; `book_or_remind` (future). *(Superseded 2026-07-20: this doc originally said `capture_lead`; the implemented tool is `capture_customer`, writing to `customers` — see R2 spec §3.)*
- Model strategy: Flash-class for routine turns, Pro-class where quality matters; revisit as pricing/models evolve. Use **context caching** on the system prompt — it's identical across all of a tenant's conversations.
- Integrate through a thin provider-agnostic adapter (one module owning the request/response mapping), so the runtime never depends on Gemini-specific payload shapes and you can swap or mix model providers per tenant later.
- No customer PII in prompts beyond what the conversation itself contains.

### n8n — cold paths only (demoted, not removed)
- Onboarding orchestration: signup completed → provision tenant → create default templates → welcome email.
- Meta template submissions and approval tracking.
- Daily/weekly lead summaries to clients; coexistence keep-alive alerts ("open your WhatsApp Business app").
- Internal ops: failed-message alerts, usage reports, billing events.
- **Never in the per-message path.**

---

## 3. Data model (functional view)

| Table | Purpose | Key fields |
|---|---|---|
| `tenants` | One row per client business | name, vertical, `wa_phone_number_id`, channel status, plan |
| `agent_configs` | Current structured config (the "recipe") | JSON config, draft/published flag |
| `prompt_versions` | Immutable compiled prompts | compiled prompt text, config snapshot, created_at |
| `conversations` | One per end-customer thread per tenant | customer wa_id, `bot_paused`, paused_until, last_message_at, active `prompt_version_id` |
| `messages` | Every message both directions | direction, source (bot / owner-app / customer), wa_message_id (idempotency key), body, media ref |
| `leads` | Captured CRM records | contact fields (per tenant's capture schema), status, source conversation |
| `contacts` | Imported + enriched contact book | wa_id, profile name, coexistence-import flag |

RLS policy on every table: `tenant_id = auth tenant claim`.

---

## 4. Key flows

### Inbound message (hot path)
1. 360dialog webhook → runtime service verifies signature, ACKs immediately, enqueues.
2. Worker dequeues → resolves tenant by `phone_number_id` → dedupe on `wa_message_id`.
3. Load conversation (create if new); if `bot_paused`, persist message and stop.
4. Assemble: published prompt version + last N messages + function declarations from config.
5. Gemini API call → response text and/or function calls (`capture_customer` writes to `customers`).
6. Send reply via 360dialog Messaging API; persist both messages; update `last_message_at` (24h-window tracking).

### Owner intervenes (coexistence)
1. Owner replies from their phone → `smb_message_echoes` webhook.
2. Runtime sets `bot_paused = true`, `paused_until = now() + X hours` on that conversation; stores the echo in `messages` (source: owner-app) so the dashboard inbox stays complete.
3. Timer or explicit dashboard toggle re-activates the bot.

### Config publish (the "automatic build")
1. Client saves config in dashboard → schema validation (Zod).
2. Compiler renders system prompt from vertical template + config → new row in `prompt_versions`.
3. Smoke evals: 5–10 canned conversations per vertical run against the draft; LLM-judge scores lead capture, refusal behavior, escalation. Fail = block publish, show client what broke.
4. Publish = flip pointer to new version. Next inbound message uses it. Nothing deploys, nothing restarts.

### Tenant onboarding
1. Signup in dashboard → Supabase Auth account + `tenants` row.
2. Vertical wizard → draft `agent_configs` (LLM-assisted: paste website/price list → normalized JSON, human review step).
3. Embedded Signup popup (360dialog-hosted) → coexistence QR scan → webhook confirms channel live → store `phone_number_id`.
4. Contact/history import webhooks populate `contacts` and `messages`.
5. Playground test → publish → live. Target: one session, no Meta console.

---

## 5. Cross-cutting concerns

- **Multi-tenancy security:** RLS everywhere; runtime service uses service-role key but always scopes queries by resolved tenant; customer-authored config text is injected into delimited data sections of the prompt, never instruction sections (prompt-injection hygiene).
- **24-hour window:** `last_message_at` on conversations gates free-form replies; outside the window the runtime falls back to approved template messages only.
- **Observability:** log every agent turn with `prompt_version_id`, latency, token counts, tool calls → enables per-tenant cost tracking, regression debugging, and A/B of template changes.
- **Coexistence keep-alive:** daily n8n check on channel health; alert clients before the ~10–12 day app-inactivity expiry.
- **GDPR/LOPDGDD:** data processing agreement with clients (you're processor, they're controller), retention policy on `messages`, deletion endpoint per contact.

---

## 6. Scaling path

| Stage | Change |
|---|---|
| 0–30 clients | Everything above as-is; Railway single instance; pgmq |
| 30–100 | Cloud Run with autoscaling; separate worker pool from webhook receiver; Redis queue if pgmq strains |
| 100+ | Evaluate direct Meta Tech Provider registration (keep 360dialog code shapes — migration is cheap by design); per-vertical prompt template teams; dedicated eval suite |

**Design invariant throughout:** configuration in the database, prompts as compiled artifacts, one multi-tenant runtime, n8n for glue only.
