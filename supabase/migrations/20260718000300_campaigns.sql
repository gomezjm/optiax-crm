-- Phase 0 · Migration 3: campaign tables, then the FKs that close the cycle
-- (messages.campaign_id / orders.campaign_id → campaigns), per spec §2 ordering note.

create table public.wa_templates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  name text not null,
  language text not null default 'es',
  category text not null,
  body text not null,
  variables jsonb not null default '[]',
  meta_status public.e_template_status not null default 'draft',
  meta_template_id text
);

create index wa_templates_tenant_id_idx on public.wa_templates (tenant_id);
create trigger set_updated_at before update on public.wa_templates
  for each row execute function private.set_updated_at();

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  name text not null,
  template_id uuid not null references public.wa_templates (id),
  segment_id uuid not null references public.segments (id),
  starts_at timestamptz,
  ends_at timestamptz,
  status public.e_campaign_status not null default 'draft',
  sent_count integer not null default 0,
  read_count integer not null default 0
);

create index campaigns_tenant_id_idx on public.campaigns (tenant_id);
create trigger set_updated_at before update on public.campaigns
  for each row execute function private.set_updated_at();

create table public.auto_reply_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id),
  name text not null,
  trigger jsonb not null, -- AutoReplyTriggerSchema in packages/shared
  response text not null,
  enabled boolean not null default true
);

create index auto_reply_rules_tenant_id_idx on public.auto_reply_rules (tenant_id);

-- Close the FK cycle now that campaigns exists.
alter table public.messages
  add constraint messages_campaign_id_fkey
  foreign key (campaign_id) references public.campaigns (id);

alter table public.orders
  add constraint orders_campaign_id_fkey
  foreign key (campaign_id) references public.campaigns (id);

create index messages_campaign_id_idx on public.messages (campaign_id) where (campaign_id is not null);
create index orders_campaign_id_idx on public.orders (campaign_id) where (campaign_id is not null);
