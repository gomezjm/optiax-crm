-- WS-D3 · Migration 10: atomic config publish (the "automatic build").
-- Migrations are append-only: never edit this file after it is committed; add a new one.
--
-- Publishing a config is three writes that must land together or not at all
-- (ws-d3 §5.2): the compiled prompt becomes a new prompt_versions row, the
-- published agent_config takes the draft's content, and tenants points its
-- active_prompt_version_id at the new row. If a half-published state were ever
-- visible, the next inbound message could run an old prompt against a new config
-- (or vice-versa). supabase-js cannot open a transaction, so the three writes
-- live inside one security-definer function — one call, one transaction.
--
-- The runtime is the only caller: it verifies the Supabase JWT, resolves the
-- tenant from the token, gates on evaluateDraft, compiles the draft in-process,
-- then calls this with the compiled prompt + the exact config it compiled. The
-- config is passed in (not re-read) so prompt_versions.config_snapshot and
-- compiled_prompt are guaranteed to correspond to one another.
--
-- prompt_versions stays insert-only (phase-0 immutability): this only INSERTs
-- there. The DRAFT row is left untouched — it remains the editable working copy
-- and the source of the dashboard's draft-differs-from-published indicator. The
-- previously-published config row is updated in place; its prior content is
-- already preserved in the prior prompt_versions snapshot, so no audit is lost.
--
-- No new table, so no RLS/tenant_id/meta-test surface. Execute is granted to
-- service_role only, matching the queue-api functions (migration 7).

create function public.publish_agent_config(
  p_tenant_id uuid,
  p_config jsonb,
  p_compiled_prompt text,
  p_compiler_version text,
  p_vertical text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version_id uuid;
begin
  -- 1. The immutable compiled artifact.
  insert into public.prompt_versions
    (tenant_id, compiled_prompt, config_snapshot, compiler_version, vertical)
  values
    (p_tenant_id, p_compiled_prompt, p_config, p_compiler_version, p_vertical)
  returning id into v_version_id;

  -- 2. Published config takes the draft's content (upsert: first publish inserts).
  update public.agent_configs
    set config = p_config
    where tenant_id = p_tenant_id and status = 'published';
  if not found then
    insert into public.agent_configs (tenant_id, config, status)
    values (p_tenant_id, p_config, 'published');
  end if;

  -- 3. Flip the pointer the runtime reads on the next inbound message.
  update public.tenants
    set active_prompt_version_id = v_version_id
    where id = p_tenant_id;

  return v_version_id;
end;
$$;

revoke execute on function public.publish_agent_config(uuid, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.publish_agent_config(uuid, jsonb, text, text, text)
  to service_role;
