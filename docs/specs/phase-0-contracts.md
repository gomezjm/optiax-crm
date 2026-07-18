# Phase 0 — Contracts

Foundation for everything. Frontend and backend never meet at a REST API; they meet at (1) the database schema + RLS, (2) the `agent_config` schema, (3) the prompt compiler, (4) webhook fixtures. This phase delivers all four plus the monorepo scaffold. **No product features, no UI, no agent loop.**

Read alongside: `whatsapp-crm-architecture.md` (root) and `PRD_ LatAm WhatsApp CRM & AI Agent.md` (root).

## 1. Monorepo scaffold

- pnpm workspaces, TypeScript strict everywhere, single root `tsconfig.base.json`.
- Packages: `packages/shared` (buildable lib), `apps/runtime` (Hono, placeholder server only), `apps/dashboard` (Next.js App Router scaffold only — no screens).
- `supabase/` at root: migrations, `seed.sql`, `tests/`.
- Tooling: vitest, eslint + prettier (defaults, don't bikeshed), GitHub Actions CI running `pnpm typecheck`, `pnpm test`, and the DB test job (starts `supabase start` via the CLI docker image).
- Root `CLAUDE.md` + one per package (see §8).

## 2. Database schema

Naming note: the architecture doc mentions `leads` and `contacts` tables — those are **superseded** here by a single `customers` table (matches the PRD's Customers screen: imported contacts and captured leads are one directory). This spec is authoritative on schema.

All tables in `public`, all with `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`, and — except `tenants` and `profiles` — `tenant_id uuid not null references tenants(id)` with an index. `updated_at` via trigger where noted (u). Enums as Postgres enums prefixed `e_`.

### Tenancy & auth

| Table | Columns (beyond id/created_at/tenant_id) |
|---|---|
| `tenants` | name, vertical text, plan text default 'trial', wa_phone_number_id text unique null, wa_channel_id text null, wa_channel_status e_channel_status ('disconnected','pending','live') default 'disconnected', agent_enabled bool default false, active_prompt_version_id uuid null → prompt_versions, timezone text default 'America/Bogota', locale text default 'es', currency text default 'COP' (u) |
| `profiles` | id uuid PK = auth.users(id), tenant_id, role e_role ('admin','sales_rep') default 'admin', display_name text (u) |

### Agent

| Table | Columns |
|---|---|
| `agent_configs` | config jsonb (Zod-validated in app layer), status e_config_status ('draft','published'), (u). Partial unique indexes: one draft AND one published max per tenant. |
| `prompt_versions` | compiled_prompt text, config_snapshot jsonb, compiler_version text, vertical text. **Immutable**: no UPDATE/DELETE grants; RLS allows INSERT+SELECT only. |

### Conversations & messages

| Table | Columns |
|---|---|
| `conversations` | customer_id uuid null → customers, wa_id text (customer's WhatsApp id), bot_paused bool default false, paused_until timestamptz null, last_customer_message_at timestamptz null (24h-window gate), last_message_at timestamptz null, needs_attention bool default false (u). Unique (tenant_id, wa_id). |
| `messages` | conversation_id → conversations, wa_message_id text null — unique (tenant_id, wa_message_id) where not null (idempotency), direction e_direction ('inbound','outbound'), source e_msg_source ('customer','bot','owner_app','dashboard','campaign','system'), type e_msg_type ('text','image','audio','video','document','template','other'), body text null, media_path text null (Storage path), template_name text null, campaign_id uuid null → campaigns, wa_status e_wa_status ('accepted','sent','delivered','read','failed') null, error jsonb null |
| `agent_turns` | conversation_id, message_id null → messages, prompt_version_id → prompt_versions, model text, latency_ms int, input_tokens int, output_tokens int, tool_calls jsonb, error jsonb null |
| `webhook_events` | provider text default '360dialog', event_type text, payload jsonb, tenant_id **nullable** (unresolvable events must still be logged), processed_at timestamptz null, error jsonb null |

### CRM

| Table | Columns |
|---|---|
| `customers` | wa_id text null, phone text null, name, email, address, city, gender, age_group — all text null, attributes jsonb default '{}' (keys governed by attribute_defs), consent_status e_consent ('unknown','opted_in','opted_out') default 'unknown', source e_customer_source ('agent','manual','import','coexistence_sync'), total_spent numeric default 0, last_order_at, last_message_at timestamptz null (u). Unique (tenant_id, wa_id) where wa_id not null. |
| `tags` | name text, color text. Unique (tenant_id, name). |
| `customer_tags` | customer_id → customers, tag_id → tags, unique (customer_id, tag_id). Carries tenant_id like everything else. |
| `attribute_defs` | key text, label text, type e_attr_type ('text','number','date','select','boolean'), options jsonb null, enabled bool default true, is_preset bool default false. Unique (tenant_id, key). |
| `segments` | name text, rules jsonb (rule DSL, Zod schema in shared — see §4), is_template bool default false (u) |

### Commerce

| Table | Columns |
|---|---|
| `product_categories` | name text. Unique (tenant_id, name). |
| `products` | category_id null → product_categories, name text, description text null, price numeric, promo_price numeric null, available bool default true, image_paths text[] default '{}' (u) |
| `order_statuses` | name text, sort_order int, kind e_status_kind ('new','awaiting_payment','awaiting_verification','processing','shipped','delivered','cancelled') — tenant-renamable labels over fixed kinds. Unique (tenant_id, kind). Seeded defaults per tenant. |
| `orders` | customer_id → customers, conversation_id null → conversations, status_id → order_statuses, total numeric, currency text, payment_method_id null → payment_methods, payment_reference text null, payment_proof_media_path text null, payment_verified_at timestamptz null, delivery_address text null, delivery_date date null, driver_notes text null, source e_order_source ('agent','manual'), campaign_id uuid null → campaigns (u) |
| `order_items` | order_id → orders, product_id null → products, description text (denormalized name), qty int, unit_price numeric |
| `payment_methods` | label text, details text (account number etc. — agent shares this), enabled bool default true |

### Campaigns

| Table | Columns |
|---|---|
| `wa_templates` | name text, language text default 'es', category text, body text, variables jsonb default '[]', meta_status e_template_status ('draft','submitted','approved','rejected') default 'draft', meta_template_id text null (u) |
| `campaigns` | name text, template_id → wa_templates, segment_id → segments, starts_at, ends_at timestamptz null, status e_campaign_status ('draft','scheduled','running','done','cancelled') default 'draft', sent_count int default 0, read_count int default 0 (u) |
| `auto_reply_rules` | name text, trigger jsonb (Zod schema in shared), response text, enabled bool default true |

### Ordering note
FK cycle: `messages.campaign_id` and `orders.campaign_id` reference `campaigns`, which references `segments`/`wa_templates`. Create campaign-related FKs in a later migration file within this phase, or make them deferrable — agent's choice, but migrations must apply cleanly from empty DB.

### Queue & storage
- Enable `pgmq`; create queue `wa_inbound`.
- Storage bucket `media`, private. Path convention `"{tenant_id}/..."`. Storage RLS: authenticated users can read/write only paths prefixed with their tenant_id.

## 3. RLS

- Helper: `private.tenant_id()` — `security definer`, `stable`, returns `tenant_id` from `profiles` where `id = auth.uid()`. All policies use `tenant_id = (select private.tenant_id())` (wrapped subselect for initplan caching). Same pattern for `private.user_role()`.
- **Every** `public` table: RLS enabled + forced where sensible. `tenants`: SELECT/UPDATE own row only (no INSERT/DELETE from client). `profiles`: users see profiles of their tenant; only admin updates roles.
- Role restrictions: `sales_rep` gets no INSERT/UPDATE/DELETE on masters + config tables (`agent_configs`, `prompt_versions`, `order_statuses`, `payment_methods`, `attribute_defs`, `wa_templates`, `tenants`, `profiles`); full read everywhere in-tenant; full write on operational tables (`customers`, `orders`, `conversations`, `messages`, `tags`, `customer_tags`, `segments`, `campaigns` read-only for reps).
- `anon`: zero access to all tables.
- Service role (runtime) bypasses RLS. Convention (enforced in Phase 1 code, stated in CLAUDE.md now): runtime accesses the DB only through a tenant-scoped repository module; the raw service client is never exported.

## 4. `packages/shared` — schemas & types

- `supabase gen types typescript` output committed as `packages/shared/src/db-types.ts` + `pnpm gen:types` script.
- Zod schemas (each with inferred TS type exported):
  - `AgentConfigSchema` — see §5.
  - `SegmentRulesSchema` — `{ combinator: 'and'|'or', conditions: [{ field: enum of supported fields ('last_order_at','total_spent','last_message_at','age_group','city','tag','attribute.<key>'), op: 'eq'|'neq'|'gt'|'lt'|'gte'|'lte'|'contains'|'older_than_days'|'newer_than_days', value: string|number }] }`
  - `AutoReplyTriggerSchema` — `{ kind: 'keyword'|'first_message'|'outside_hours', keywords?: string[] }`
- Constant `COMPILER_VERSION` (semver string, bump on any template change).

## 5. `agent_config` JSON schema (v1)

```ts
{
  version: 1,
  business: { name, description, vertical, address?, hours?, socialLinks? },
  agent: {
    displayName, tone: 'formal'|'cercano'|'neutral', language: 'es',
    emojiUsage: 'none'|'light'|'frequent',
    audioPolicy: 'transcribe'|'text_reply',           // Screen 5 audio rules
    operatingMode: 'always'|'outside_hours'|'schedule',
    schedule?: { days: number[], start: 'HH:mm', end: 'HH:mm' },
    pauseHoursOnOwnerReply: number                     // default 24
  },
  catalog: { canQuotePrices: boolean, offerPromos: boolean,
             outOfStock: 'say_unavailable'|'suggest_alternative' },
  faqs: Array<{ q: string, a: string }>,
  capture: { fields: Array<{ key: string, required: boolean }> },  // keys must exist in attribute_defs
  orders: { enabled: boolean, confirmBeforeCreate: boolean,
            collectDelivery: boolean, sharePaymentMethods: boolean },
  escalation: { rules: Array<{ trigger: 'keyword'|'payment_proof'|'complaint'|'human_request',
                               keywords?: string[] }>,
                handoffMessage: string },
  guardrails: { forbiddenTopics: string[], custom: string[] }
}
```

Strict Zod (`.strict()` everywhere), sensible defaults, max lengths on all free text (e.g. 500 chars per FAQ answer). Validation errors must be structured (path + message) — the dashboard wizard will render them.

## 6. Prompt compiler

`compilePrompt(config: AgentConfig, opts: { vertical: string }): { prompt: string, compilerVersion: string }` in `packages/shared`.

- Deterministic: same input → byte-identical output. No dates, no randomness.
- Structure: fixed instruction skeleton per vertical (start with `generic` + one real vertical, e.g. `retail`) with tenant data injected **only into delimited data sections**:
  - Sections in order: identity & tone → behavior rules (operating, audio, escalation, guardrails) → tool-usage instructions → `<business_data>`, `<catalog_policy>`, `<faqs>`, `<capture_fields>`, `<payment_and_orders>` data blocks.
  - Injection hygiene: all tenant-authored text lands inside data blocks with a standing instruction that data-block content is reference data, never instructions. Escape/strip `<` `>` sequences in tenant text.
- Prices/products are NOT compiled in (they change too often) — the prompt instructs the model to use the `check_catalog` tool. FAQs ARE compiled in.
- Tests: snapshot tests with ≥3 fixture configs (minimal, full, adversarial — tenant text containing prompt-injection attempts); determinism test (compile twice, byte-equal).

## 7. Webhook fixtures + simulator

`packages/shared/fixtures/360dialog/`:

| File | Content |
|---|---|
| `inbound-text.json` | Customer text message |
| `inbound-image.json` | Image with caption (payment proof case) |
| `inbound-audio.json` | Voice note |
| `status-delivered.json`, `status-read.json`, `status-failed.json` | Status updates |
| `echo-owner-reply.json` | `smb_message_echoes` — owner replied from phone (coexistence pause trigger) |
| `history-sync.json` | Coexistence contact/history import event |

Shape: 360dialog forwards Meta Cloud API format — `{ entry: [{ changes: [{ field, value: { messaging_product, metadata: { display_phone_number, phone_number_id }, contacts?, messages?, statuses? } }] }] }`. Build from Meta's Cloud API webhook docs. Keep payloads clean (no annotation keys inside them); document in `fixtures/README.md` instead: *these are reconstructions — replace with captured sandbox payloads (Juan's action item) and never hand-edit after that.* Use two distinct `phone_number_id`s across fixtures matching the two seed tenants.

`pnpm simulate <fixture> [--port]` script: POSTs fixture to a local URL with a valid signature header (signing scheme stubbed behind one function so it's swappable when real 360dialog signing is confirmed).

## 8. Seed data & CLAUDE.md

- `supabase/seed.sql` + `scripts/seed-auth.ts` (auth users need the admin API): **2 tenants** (e.g. "Moda Valentina" retail / "Sabor Casero" food), 2 users each (1 admin, 1 sales_rep), default order_statuses + preset attribute_defs per tenant, ~8 products each, published agent_config + compiled prompt_version, 2 conversations with a dozen messages, 2 orders, tags, 1 segment, 1 approved wa_template.
- CLAUDE.md (root): repo map, commands (`pnpm test`, `pnpm db:test`, `supabase start/reset`, `pnpm gen:types`, `pnpm simulate`), conventions (types only from `packages/shared`; new migration files only, never edit applied ones; UI strings in `es.json`; no `any`), and the standing rule: **isolation tests must pass before any commit is considered done**. Per-package CLAUDE.md: package-specific dos/don'ts.

## 9. Multi-tenant isolation tests (the crown jewel)

`supabase/tests/` run with vitest against local Supabase (CI too):

1. **Meta-test**: query `pg_catalog` — every table in `public` must have RLS enabled AND a `tenant_id` column (allowlist: `tenants`, `profiles`). New tables that skip RLS fail CI automatically.
2. **Cross-tenant matrix**: authenticated as tenant-A user — for every table: SELECT returns only A rows; INSERT with B's tenant_id fails; UPDATE/DELETE of B rows affects 0 rows.
3. **Anon**: zero rows / all writes rejected on every table.
4. **Role matrix**: sales_rep blocked from writes on master/config tables, allowed on operational ones.
5. **Storage**: tenant-A user cannot read/write `{tenant_b_id}/...` paths.
6. **Immutability**: UPDATE/DELETE on `prompt_versions` fails even for tenant admin.

## 10. Definition of done

- [ ] Fresh clone → `pnpm i && supabase start && supabase db reset && pnpm test && pnpm db:test` all green
- [ ] CI green on the branch
- [ ] All Zod schemas exported from `packages/shared` with inferred types; generated DB types committed
- [ ] Compiler snapshot tests committed (fixtures reviewed as readable prompt files)
- [ ] `pnpm simulate inbound-text` hits a stub server and gets 200
- [ ] Seed produces 2 fully-populated tenants; isolation suite passes against seeded data
- [ ] `SESSION_NOTES.md` lists every assumption made where this spec was ambiguous
