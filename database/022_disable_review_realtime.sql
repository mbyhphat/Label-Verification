-- 022_disable_review_realtime.sql
-- Run after 021_review_items_true_pagination.sql.
-- Disables Supabase Realtime for the review workspace so polling can replace
-- database-change subscriptions without driving realtime.list_changes CPU.

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'review_items'
    ) then
      alter publication supabase_realtime drop table public.review_items;
    end if;

    if exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'review_samples'
    ) then
      alter publication supabase_realtime drop table public.review_samples;
    end if;
  else
    raise notice 'Publication supabase_realtime was not found. Nothing to disable.';
  end if;
end $$;

alter table public.review_items replica identity default;
alter table public.review_samples replica identity default;

notify pgrst, 'reload schema';
