-- 004_realtime.sql
-- Run after 003_rpc_functions.sql.
-- Purpose:
--   Prepare collaborative update streams for the frontend.
--   This file configures review_samples and review_items so Supabase Realtime
--   can publish useful row-change payloads for locks, status updates,
--   completed decisions, and stale-row detection.

alter table public.review_samples replica identity full;
alter table public.review_items replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'review_samples'
    ) then
      alter publication supabase_realtime add table public.review_samples;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'review_items'
    ) then
      alter publication supabase_realtime add table public.review_items;
    end if;
  else
    raise notice 'Publication supabase_realtime was not found. Enable Realtime from the Supabase dashboard.';
  end if;
end $$;
