-- Phase 1 · Migration 7: Realtime on `messages` + service-role RPC wrappers for pgmq.
--
-- (a) The dashboard inbox subscribes to postgres_changes on public.messages;
--     the table must be in the supabase_realtime publication. RLS still scopes
--     what each subscriber receives (WALRUS uses the user's JWT).
-- (b) PostgREST only exposes the `public` schema, so the runtime worker reaches
--     the `wa_inbound` queue through these wrappers. security definer (owner:
--     postgres, who owns the pgmq objects); EXECUTE is service_role-only —
--     clients never touch the queue.

-- ── Realtime ─────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.messages;

-- ── pgmq wrappers (service_role only) ────────────────────────────────────────

create function public.wa_inbound_send(payload jsonb) returns bigint
language sql security definer set search_path = ''
as $$
  select pgmq.send('wa_inbound', payload)
$$;

create function public.wa_inbound_read(max_messages integer, vt_seconds integer)
returns table (msg_id bigint, read_ct integer, message jsonb)
language sql security definer set search_path = ''
as $$
  select r.msg_id, r.read_ct, r.message
  from pgmq.read('wa_inbound', vt_seconds, max_messages) r
$$;

create function public.wa_inbound_archive(queue_msg_id bigint) returns boolean
language sql security definer set search_path = ''
as $$
  select pgmq.archive('wa_inbound', queue_msg_id)
$$;

revoke execute on function public.wa_inbound_send(jsonb) from public, anon, authenticated;
revoke execute on function public.wa_inbound_read(integer, integer) from public, anon, authenticated;
revoke execute on function public.wa_inbound_archive(bigint) from public, anon, authenticated;

grant execute on function public.wa_inbound_send(jsonb) to service_role;
grant execute on function public.wa_inbound_read(integer, integer) to service_role;
grant execute on function public.wa_inbound_archive(bigint) to service_role;
