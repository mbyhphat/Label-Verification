-- 020_list_review_items_page_2args.sql
-- Run after 019_list_review_items_paged.sql.
-- PostgREST / supabase-js may omit JSON keys whose value is null. When payload
-- is only {"p_dataset_id","p_limit"}, Postgres needs this 2-arg overload or
-- the API responds "function ... not found in schema cache".

create or replace function public.list_review_items_page(
  p_dataset_id uuid,
  p_limit int
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.list_review_items_page(p_dataset_id, p_limit, null::jsonb);
$$;

grant execute on function public.list_review_items_page(uuid, integer) to authenticated;
