-- WS-D2 · Migration 8: keep customers.total_spent / last_order_at in step with orders.
-- Migrations are append-only: never edit this file after it is committed; add a new one.
--
-- Both columns are denormalized rollups the customers directory sorts and
-- filters on, so they cannot be computed per render. This trigger recomputes
-- them from scratch for the affected customer on every orders write. A full
-- recompute is self-healing — any drift (a manual SQL fix, a failed
-- transaction, a backfill) is repaired by the next write touching that
-- customer — where incremental deltas silently accumulate error forever.
--
-- Fires for service-role writes too, so R2's agent-created orders inherit it
-- without the runtime having to remember. RLS is untouched: the function is
-- security definer so it can write a customers row the *caller* may only see
-- through their tenant policy, but it is only ever reachable via a trigger on
-- an orders row that RLS already authorized.
--
-- REVISIT LATER: `awaiting_payment` orders DO count toward total_spent in v1 —
-- only `cancelled` is excluded. If owners come to read total_spent as "money
-- actually received" rather than "value ordered", narrow this to the paid
-- kinds instead. Deliberate v1 choice, not an oversight (D2 §4).

create or replace function private.recompute_customer_order_metrics(p_customer_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.customers c
     set total_spent   = coalesce(agg.total, 0),
         last_order_at = agg.last_at
    from (
      select sum(o.total) as total, max(o.created_at) as last_at
        from public.orders o
        join public.order_statuses s on s.id = o.status_id
       where o.customer_id = p_customer_id
         and s.kind <> 'cancelled'
    ) agg
   where c.id = p_customer_id;
$$;

create or replace function private.orders_sync_customer_metrics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.recompute_customer_order_metrics(old.customer_id);
    return old;
  end if;

  -- Reassigning an order to another customer leaves the *old* customer's
  -- rollup stale as well, so both sides get recomputed.
  if tg_op = 'UPDATE' and new.customer_id is distinct from old.customer_id then
    perform private.recompute_customer_order_metrics(old.customer_id);
  end if;

  perform private.recompute_customer_order_metrics(new.customer_id);
  return new;
end;
$$;

-- Client roles never call these directly; the trigger runs them as the definer.
revoke all on function private.recompute_customer_order_metrics(uuid) from public, anon, authenticated;
revoke all on function private.orders_sync_customer_metrics() from public, anon, authenticated;

create trigger orders_sync_customer_metrics
  after insert or update or delete on public.orders
  for each row execute function private.orders_sync_customer_metrics();
