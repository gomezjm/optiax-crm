-- Phase 0 · Migration 2: core tables (tenancy, agent, CRM, conversations, commerce).
-- Campaign tables + the FKs pointing at them live in the next migration (FK cycle note, spec §2).

-- ── Tenancy & auth ───────────────────────────────────────────────────────────

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  vertical text not null,
  plan text not null default 'trial',
  wa_phone_number_id text unique,
  wa_channel_id text,
  wa_channel_status public.e_channel_status not null default 'disconnected',
  agent_enabled boolean not null default false,
  active_prompt_version_id uuid, -- FK added below, after prompt_versions exists
  timezone text not null default 'America/Bogota',
  locale text not null default 'es',
  currency text not null default 'COP'
);

create trigger set_updated_at before update on public.tenants
  for each row execute function private.set_updated_at();

-- profiles.id mirrors auth.users(id); no gen_random_uuid default on purpose.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  role public.e_role not null default 'admin',
  display_name text not null
);

create index profiles_tenant_id_idx on public.profiles (tenant_id);
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- ── Agent ────────────────────────────────────────────────────────────────────

create table public.agent_configs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  config jsonb not null, -- Zod-validated in the app layer (AgentConfigSchema)
  status public.e_config_status not null default 'draft'
);

create index agent_configs_tenant_id_idx on public.agent_configs (tenant_id);
-- At most one draft and one published config per tenant.
create unique index agent_configs_one_draft_per_tenant
  on public.agent_configs (tenant_id) where (status = 'draft');
create unique index agent_configs_one_published_per_tenant
  on public.agent_configs (tenant_id) where (status = 'published');
create trigger set_updated_at before update on public.agent_configs
  for each row execute function private.set_updated_at();

-- Immutable audit artifact: compiled prompts. No updated_at by design.
create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  compiled_prompt text not null,
  config_snapshot jsonb not null,
  compiler_version text not null,
  vertical text not null
);

create index prompt_versions_tenant_id_idx on public.prompt_versions (tenant_id);

alter table public.tenants
  add constraint tenants_active_prompt_version_id_fkey
  foreign key (active_prompt_version_id) references public.prompt_versions (id);

-- ── CRM ──────────────────────────────────────────────────────────────────────

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  wa_id text,
  phone text,
  name text,
  email text,
  address text,
  city text,
  gender text,
  age_group text,
  attributes jsonb not null default '{}', -- keys governed by attribute_defs
  consent_status public.e_consent not null default 'unknown',
  source public.e_customer_source not null,
  total_spent numeric not null default 0,
  last_order_at timestamptz,
  last_message_at timestamptz
);

create index customers_tenant_id_idx on public.customers (tenant_id);
create unique index customers_tenant_wa_id_uniq
  on public.customers (tenant_id, wa_id) where (wa_id is not null);
create trigger set_updated_at before update on public.customers
  for each row execute function private.set_updated_at();

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  name text not null,
  color text not null,
  unique (tenant_id, name)
);

create index tags_tenant_id_idx on public.tags (tenant_id);

create table public.customer_tags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  customer_id uuid not null references public.customers (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  unique (customer_id, tag_id)
);

create index customer_tags_tenant_id_idx on public.customer_tags (tenant_id);

create table public.attribute_defs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  key text not null,
  label text not null,
  type public.e_attr_type not null,
  options jsonb,
  enabled boolean not null default true,
  is_preset boolean not null default false,
  unique (tenant_id, key)
);

create index attribute_defs_tenant_id_idx on public.attribute_defs (tenant_id);

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  name text not null,
  rules jsonb not null, -- SegmentRulesSchema in packages/shared
  is_template boolean not null default false
);

create index segments_tenant_id_idx on public.segments (tenant_id);
create trigger set_updated_at before update on public.segments
  for each row execute function private.set_updated_at();

-- ── Conversations & messages ────────────────────────────────────────────────

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  customer_id uuid references public.customers (id),
  wa_id text not null, -- end customer's WhatsApp id
  bot_paused boolean not null default false,
  paused_until timestamptz,
  last_customer_message_at timestamptz, -- 24h-window gate
  last_message_at timestamptz,
  needs_attention boolean not null default false,
  unique (tenant_id, wa_id)
);

create index conversations_tenant_id_idx on public.conversations (tenant_id);
create index conversations_customer_id_idx on public.conversations (customer_id);
create trigger set_updated_at before update on public.conversations
  for each row execute function private.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  wa_message_id text,
  direction public.e_direction not null,
  source public.e_msg_source not null,
  type public.e_msg_type not null,
  body text,
  media_path text, -- Storage path within the `media` bucket
  template_name text,
  campaign_id uuid, -- FK added in the campaigns migration (cycle note, spec §2)
  wa_status public.e_wa_status,
  error jsonb
);

create index messages_tenant_id_idx on public.messages (tenant_id);
create index messages_conversation_id_idx on public.messages (conversation_id);
-- Idempotency: dedupe inbound webhooks on WhatsApp message id.
create unique index messages_tenant_wa_message_id_uniq
  on public.messages (tenant_id, wa_message_id) where (wa_message_id is not null);

create table public.agent_turns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id uuid references public.messages (id),
  prompt_version_id uuid not null references public.prompt_versions (id),
  model text not null,
  latency_ms integer not null,
  input_tokens integer not null,
  output_tokens integer not null,
  tool_calls jsonb not null default '[]',
  error jsonb
);

create index agent_turns_tenant_id_idx on public.agent_turns (tenant_id);
create index agent_turns_conversation_id_idx on public.agent_turns (conversation_id);

-- tenant_id is intentionally NULLABLE here: events that cannot be resolved to a
-- tenant (unknown phone_number_id, malformed payloads) must still be logged.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid references public.tenants (id),
  provider text not null default '360dialog',
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  error jsonb
);

create index webhook_events_tenant_id_idx on public.webhook_events (tenant_id);

-- ── Commerce ─────────────────────────────────────────────────────────────────

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  name text not null,
  unique (tenant_id, name)
);

create index product_categories_tenant_id_idx on public.product_categories (tenant_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  category_id uuid references public.product_categories (id),
  name text not null,
  description text,
  price numeric not null,
  promo_price numeric,
  available boolean not null default true,
  image_paths text[] not null default '{}'
);

create index products_tenant_id_idx on public.products (tenant_id);
create trigger set_updated_at before update on public.products
  for each row execute function private.set_updated_at();

-- Tenant-renamable labels over fixed kinds.
create table public.order_statuses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  name text not null,
  sort_order integer not null,
  kind public.e_status_kind not null,
  unique (tenant_id, kind)
);

create index order_statuses_tenant_id_idx on public.order_statuses (tenant_id);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  label text not null,
  details text not null, -- account number etc. — the agent shares this
  enabled boolean not null default true
);

create index payment_methods_tenant_id_idx on public.payment_methods (tenant_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  customer_id uuid not null references public.customers (id),
  conversation_id uuid references public.conversations (id),
  status_id uuid not null references public.order_statuses (id),
  total numeric not null,
  currency text not null,
  payment_method_id uuid references public.payment_methods (id),
  payment_reference text,
  payment_proof_media_path text,
  payment_verified_at timestamptz,
  delivery_address text,
  delivery_date date,
  driver_notes text,
  source public.e_order_source not null,
  campaign_id uuid -- FK added in the campaigns migration (cycle note, spec §2)
);

create index orders_tenant_id_idx on public.orders (tenant_id);
create index orders_customer_id_idx on public.orders (customer_id);
create trigger set_updated_at before update on public.orders
  for each row execute function private.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id),
  description text not null, -- denormalized product name at time of order
  qty integer not null,
  unit_price numeric not null
);

create index order_items_tenant_id_idx on public.order_items (tenant_id);
create index order_items_order_id_idx on public.order_items (order_id);
