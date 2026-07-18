-- Phase 0 · Migration 5: pgmq queue + private media bucket with tenant-prefix RLS.

-- ── Queue ────────────────────────────────────────────────────────────────────

create extension if not exists pgmq;
select pgmq.create('wa_inbound');

-- ── Storage: private `media` bucket ─────────────────────────────────────────
-- Path convention: "{tenant_id}/..." — first path segment is the owning tenant.

insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

-- Authenticated users can only touch objects whose path is prefixed with their
-- own tenant_id. anon gets nothing (no policies).

create policy media_tenant_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
  );

create policy media_tenant_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
  );

create policy media_tenant_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
  )
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
  );

create policy media_tenant_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select private.tenant_id())::text
  );
