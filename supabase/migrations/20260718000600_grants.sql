-- Phase 0 · Migration 6: explicit table privileges for API roles.
--
-- The Supabase Postgres image's default ACLs no longer hand DML on
-- postgres-owned tables to the API roles — grants are explicit opt-in.
-- That suits us: state exactly what each role may do; RLS then scopes rows.
--   · authenticated → DML everywhere except prompt_versions UPDATE/DELETE
--     (immutability), tenants/profiles INSERT/DELETE (no client provisioning).
--   · service_role  → full DML (bypasses RLS; used only by the runtime through
--     the tenant-scoped repository module — see CLAUDE.md).
--   · anon          → nothing (re-asserted).

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Future tables created by migrations (role postgres) get the same DML grants;
-- the isolation meta-test still forces RLS + tenant_id on each of them.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

-- Carve-outs (re-asserted after the broad grants above):
revoke update, delete on public.prompt_versions from authenticated; -- immutable
revoke insert, delete on public.tenants from authenticated;         -- service-role provisioning only
revoke insert, delete on public.profiles from authenticated;        -- created via admin API

-- anon stays at zero.
revoke all on all tables in schema public from anon;
