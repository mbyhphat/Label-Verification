-- 015_project_class_statistics_rpc.sql
-- Run after 014_list_review_items_rpc_jsonb.sql.
-- Purpose:
--   Give project owners/admins a compact per-class review item count for the
--   admin UI without pulling all review_items into the browser.

create or replace function public.list_project_class_statistics(p_project_id uuid)
returns table (
  entity_type text,
  item_count bigint,
  pending_count bigint,
  completed_count bigint,
  skipped_count bigint,
  dataset_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not private.can_admin_project(p_project_id) then
    raise exception 'not_allowed';
  end if;

  return query
  with required_classes as (
    select required.entity_type, required.ordinality::integer as ordinality
    from unnest(
      coalesce(
        (
          select config.required_entity_types
          from public.project_pii_configs config
          where config.project_id = p_project_id
        ),
        private.default_pii_entity_types()
      )
    ) with ordinality as required(entity_type, ordinality)
  ),
  imported_classes as (
    select distinct ri.entity_type
    from public.review_items ri
    join public.datasets d on d.id = ri.dataset_id
    where d.project_id = p_project_id
  ),
  imported_classes_ordered as (
    select
      imported_classes.entity_type,
      row_number() over (order by imported_classes.entity_type)::integer as ordinality
    from imported_classes
  ),
  class_scope as (
    select scoped.entity_type, min(scoped.display_order) as display_order
    from (
      select
        required_classes.entity_type,
        coalesce(catalog.sort_order, 100000 + required_classes.ordinality) as display_order
      from required_classes
      left join public.pii_entity_types catalog
        on catalog.entity_type = required_classes.entity_type

      union all

      select
        imported_classes_ordered.entity_type,
        coalesce(catalog.sort_order, 200000 + imported_classes_ordered.ordinality) as display_order
      from imported_classes_ordered
      left join public.pii_entity_types catalog
        on catalog.entity_type = imported_classes_ordered.entity_type
    ) scoped
    group by scoped.entity_type
  ),
  aggregates as (
    select
      ri.entity_type,
      count(*) as item_count,
      count(*) filter (where ri.status = 'pending') as pending_count,
      count(*) filter (where ri.status = 'completed') as completed_count,
      count(*) filter (where ri.status = 'skipped') as skipped_count,
      count(distinct ri.dataset_id) as dataset_count
    from public.review_items ri
    join public.datasets d on d.id = ri.dataset_id
    where d.project_id = p_project_id
    group by ri.entity_type
  )
  select
    class_scope.entity_type,
    coalesce(aggregates.item_count, 0)::bigint as item_count,
    coalesce(aggregates.pending_count, 0)::bigint as pending_count,
    coalesce(aggregates.completed_count, 0)::bigint as completed_count,
    coalesce(aggregates.skipped_count, 0)::bigint as skipped_count,
    coalesce(aggregates.dataset_count, 0)::bigint as dataset_count
  from class_scope
  left join aggregates on aggregates.entity_type = class_scope.entity_type
  order by class_scope.display_order, class_scope.entity_type;
end;
$$;

grant execute on function public.list_project_class_statistics(uuid) to authenticated;
