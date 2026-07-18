-- Phase 0 · Migration 1: extensions, private schema, enums, shared trigger helpers.
-- Migrations are append-only: never edit this file after it is committed; add a new one.

-- `private` schema holds security-definer helpers that must not be exposed via PostgREST.
create schema if not exists private;

-- updated_at maintenance trigger, attached to tables marked (u) in the spec.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Enums (prefixed e_ per spec) ─────────────────────────────────────────────
create type public.e_channel_status as enum ('disconnected', 'pending', 'live');
create type public.e_role as enum ('admin', 'sales_rep');
create type public.e_config_status as enum ('draft', 'published');
create type public.e_direction as enum ('inbound', 'outbound');
create type public.e_msg_source as enum ('customer', 'bot', 'owner_app', 'dashboard', 'campaign', 'system');
create type public.e_msg_type as enum ('text', 'image', 'audio', 'video', 'document', 'template', 'other');
create type public.e_wa_status as enum ('accepted', 'sent', 'delivered', 'read', 'failed');
create type public.e_consent as enum ('unknown', 'opted_in', 'opted_out');
create type public.e_customer_source as enum ('agent', 'manual', 'import', 'coexistence_sync');
create type public.e_attr_type as enum ('text', 'number', 'date', 'select', 'boolean');
create type public.e_status_kind as enum ('new', 'awaiting_payment', 'awaiting_verification', 'processing', 'shipped', 'delivered', 'cancelled');
create type public.e_order_source as enum ('agent', 'manual');
create type public.e_template_status as enum ('draft', 'submitted', 'approved', 'rejected');
create type public.e_campaign_status as enum ('draft', 'scheduled', 'running', 'done', 'cancelled');
