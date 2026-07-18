-- Phase 0 · Migration 4: RLS — helpers, enable/force, tenant isolation, role matrix.
--
-- Policy model (spec §3):
--   · Every public table: RLS enabled. Forced everywhere EXCEPT `profiles`
--     (private.tenant_id() is security definer and reads profiles; forcing RLS there
--     would make policy evaluation recurse — the definer/owner bypass is the standard
--     Supabase pattern and is only sound while profiles is not forced).
--   · anon: zero access (privileges revoked AND no policies).
--   · authenticated: tenant-scoped via private.tenant_id(); admin-only writes on
--     master/config tables via private.user_role().
--   · service_role: bypasses RLS (runtime); must only be used through the
--     tenant-scoped repository module (convention, see CLAUDE.md).

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function private.tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

create or replace function private.user_role()
returns public.e_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;

revoke all on function private.tenant_id() from public, anon;
revoke all on function private.user_role() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.tenant_id() to authenticated;
grant execute on function private.user_role() to authenticated;

-- ── anon: zero access ────────────────────────────────────────────────────────

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke usage on schema public from anon;

-- ── Enable + force RLS on every public table ────────────────────────────────

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    if t.tablename <> 'profiles' then
      execute format('alter table public.%I force row level security', t.tablename);
    end if;
  end loop;
end $$;

-- ── tenants: SELECT/UPDATE own row only; no client INSERT/DELETE ────────────

create policy tenants_select on public.tenants
  for select to authenticated
  using (id = (select private.tenant_id()));

create policy tenants_update on public.tenants
  for update to authenticated
  using (id = (select private.tenant_id()) and (select private.user_role()) = 'admin')
  with check (id = (select private.tenant_id()) and (select private.user_role()) = 'admin');

-- ── profiles: read own tenant's profiles; only admin updates (incl. roles) ──

create policy profiles_select on public.profiles
  for select to authenticated
  using (tenant_id = (select private.tenant_id()));

create policy profiles_update on public.profiles
  for update to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.user_role()) = 'admin')
  with check (tenant_id = (select private.tenant_id()) and (select private.user_role()) = 'admin');

-- ── prompt_versions: immutable — INSERT (admin) + SELECT only ───────────────

create policy prompt_versions_select on public.prompt_versions
  for select to authenticated
  using (tenant_id = (select private.tenant_id()));

create policy prompt_versions_insert on public.prompt_versions
  for insert to authenticated
  with check (tenant_id = (select private.tenant_id()) and (select private.user_role()) = 'admin');

-- Belt and suspenders on top of "no UPDATE/DELETE policies": drop the grants too.
revoke update, delete on public.prompt_versions from authenticated;

-- ── Everything else: generated tenant-scoped policies ───────────────────────
--
--   operational  → full write for every tenant member (admin + sales_rep)
--   admin_write  → SELECT for members, writes require role = admin
--   runtime_only → SELECT for members, no client writes (rows come from service role)

do $$
declare
  t text;
  operational text[] := array[
    'customers', 'tags', 'customer_tags', 'segments',
    'conversations', 'messages',
    'orders', 'order_items', 'products', 'product_categories'
  ];
  admin_write text[] := array[
    'agent_configs', 'attribute_defs', 'order_statuses', 'payment_methods',
    'wa_templates', 'campaigns', 'auto_reply_rules'
  ];
  runtime_only text[] := array['agent_turns', 'webhook_events'];
  tenant_check text := 'tenant_id = (select private.tenant_id())';
  admin_check text := 'tenant_id = (select private.tenant_id()) and (select private.user_role()) = ''admin''';
begin
  foreach t in array operational || admin_write || runtime_only loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      t || '_select', t, tenant_check);
  end loop;

  foreach t in array operational loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (%s)',
      t || '_insert', t, tenant_check);
    execute format(
      'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
      t || '_update', t, tenant_check, tenant_check);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (%s)',
      t || '_delete', t, tenant_check);
  end loop;

  foreach t in array admin_write loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (%s)',
      t || '_insert', t, admin_check);
    execute format(
      'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
      t || '_update', t, admin_check, admin_check);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (%s)',
      t || '_delete', t, admin_check);
  end loop;
  -- runtime_only: intentionally no INSERT/UPDATE/DELETE policies for authenticated.
end $$;
