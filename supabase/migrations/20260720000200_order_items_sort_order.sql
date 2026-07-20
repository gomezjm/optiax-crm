-- WS-R2 · Migration 9: explicit line ordering for order_items.
-- Migrations are append-only: never edit this file after it is committed; add a new one.
--
-- Order lines are a sequence the customer dictated ("dos blusas y un pantalón"),
-- but nothing recorded that sequence: readers fell back to created_at, which
-- ties for rows inserted in the same statement and leaves the display order up
-- to the planner. R2's `create_order` tool writes several items at once, so the
-- ambiguity became reachable in practice (D2 §7.E).
--
-- Additive and non-breaking: `default 0` means every existing row and every
-- writer that ignores the column keeps working. Existing rows are left at 0 —
-- backfilling a per-order sequence from created_at would invent an ordering
-- the seed data never actually asserted. Readers that care about ordering
-- should sort by (sort_order, created_at), which degrades to today's behavior
-- for untouched rows.
--
-- No RLS/grant changes: this adds a column to a table that already has both,
-- and inherits them.

alter table public.order_items
  add column sort_order integer not null default 0;

comment on column public.order_items.sort_order is
  'Display position of the line within its order, ascending from 0. Written by
   the R2 create_order tool in insertion order and by the dashboard composer.
   Not unique: ties fall back to created_at.';

-- Ordering is always scoped to one order, so the existing order_id index gets
-- the composite treatment rather than a standalone index on sort_order.
create index order_items_order_id_sort_order_idx
  on public.order_items (order_id, sort_order);
