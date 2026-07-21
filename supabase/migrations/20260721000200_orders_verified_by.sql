-- WS-D4 §0.1 (carry-in from D2-B): record *who* verified a payment, not just
-- *when*. `payment_verified_at` already stored the timestamp; `verified_by`
-- closes the audit gap so the order drawer can show "verificado por {name}".
--
-- Additive, nullable — historical orders (and agent-created ones) keep a null
-- verifier. Reps as well as admins verify payments (orders are operational in
-- the role matrix), so this references any tenant profile, not only admins.
--
-- No new GRANTs: column privileges are inherited from the table-level grants in
-- migration 6 (authenticated has UPDATE on orders); RLS still scopes the rows.
-- Isolation/meta stay green — orders already has RLS + tenant_id.

alter table public.orders
  add column verified_by uuid references public.profiles (id);

comment on column public.orders.verified_by is
  'Profile that marked the payment verified (WS-D4 §0.1). Null for agent/historical orders.';
