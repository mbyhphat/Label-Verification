-- 023_review_items_labeled_view.sql
-- Run after 022_disable_review_realtime.sql.
-- Adds a latest-first, read-only view over completed review items.

create index if not exists review_items_dataset_labeled_latest_all_idx
on public.review_items (
  dataset_id,
  decided_at desc nulls last,
  updated_at desc,
  id desc
)
where status = 'completed'
  and decision is not null;

create index if not exists review_items_dataset_labeled_latest_entity_idx
on public.review_items (
  dataset_id,
  entity_type,
  decided_at desc nulls last,
  updated_at desc,
  id desc
)
where status = 'completed'
  and decision is not null;

create or replace function public.count_labeled_review_items_filtered(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_dataset_id uuid;
  v_entity_type text;
  v_verdict text;
  v_search text;
begin
  if p_request is null then
    raise exception 'missing_request';
  end if;

  v_dataset_id := nullif(p_request ->> 'dataset_id', '')::uuid;
  v_entity_type := nullif(trim(coalesce(p_request ->> 'entity_type', '')), '');
  v_verdict := nullif(trim(coalesce(p_request ->> 'verdict', '')), '');
  v_search := lower(nullif(trim(coalesce(p_request ->> 'search', '')), ''));

  if v_dataset_id is null then
    raise exception 'missing_dataset_id';
  end if;

  if v_verdict = 'ALL' then
    v_verdict := null;
  end if;

  if v_verdict is not null and v_verdict not in ('CORRECT', 'WRONG_LABEL', 'UNREALISTIC_VALUE') then
    raise exception 'invalid_verdict';
  end if;

  return (
    with scoped as (
      select
        ri.entity_type,
        ri.verdict,
        ri.decision,
        ri.value,
        ri.reason,
        ri.suggested_label,
        ri.sample_key
      from public.review_items ri
      join public.datasets d on d.id = ri.dataset_id
      where ri.dataset_id = v_dataset_id
        and ri.status = 'completed'
        and ri.decision is not null
        and private.is_project_member(d.project_id)
    ),
    entity_types as (
      select coalesce(array_agg(distinct entity_type order by entity_type), '{}'::text[]) as rows
      from scoped
    ),
    filtered as (
      select *
      from scoped
      where (v_entity_type is null or entity_type = v_entity_type)
        and (v_verdict is null or verdict = v_verdict)
        and (
          v_search is null
          or lower(
            coalesce(value, '') || ' ' ||
            coalesce(reason, '') || ' ' ||
            coalesce(suggested_label, '') || ' ' ||
            coalesce(entity_type, '') || ' ' ||
            coalesce(sample_key, '')
          ) like '%' || v_search || '%'
        )
    )
    select jsonb_build_object(
      'filtered_total', count(*),
      'total', count(*),
      'pending', 0,
      'completed', count(*),
      'skipped', 0,
      'correct', count(*) filter (where verdict = 'CORRECT'),
      'wrong_label', count(*) filter (where verdict = 'WRONG_LABEL'),
      'unrealistic_value', count(*) filter (where verdict = 'UNREALISTIC_VALUE'),
      'accept', count(*) filter (where decision = 'accept'),
      'deny', count(*) filter (where decision = 'deny'),
      'deny_keep', count(*) filter (where decision = 'deny_keep'),
      'deny_remove', count(*) filter (where decision = 'deny_remove'),
      'entity_types', coalesce(to_jsonb((select rows from entity_types)), '[]'::jsonb)
    )
    from filtered
  );
end;
$$;

grant execute on function public.count_labeled_review_items_filtered(jsonb) to authenticated;

create or replace function public.list_labeled_review_items_page(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_dataset_id uuid;
  v_limit int;
  v_after jsonb;
  v_entity_type text;
  v_verdict text;
  v_search text;
begin
  if p_request is null then
    raise exception 'missing_request';
  end if;

  v_dataset_id := nullif(p_request ->> 'dataset_id', '')::uuid;
  v_limit := least(greatest(coalesce(nullif(p_request ->> 'limit', '')::int, 250), 1), 1000);
  v_after := case
    when p_request ? 'after' and jsonb_typeof(p_request -> 'after') <> 'null'
    then p_request -> 'after'
    else null::jsonb
  end;
  v_entity_type := nullif(trim(coalesce(p_request ->> 'entity_type', '')), '');
  v_verdict := nullif(trim(coalesce(p_request ->> 'verdict', '')), '');
  v_search := lower(nullif(trim(coalesce(p_request ->> 'search', '')), ''));

  if v_dataset_id is null then
    raise exception 'missing_dataset_id';
  end if;

  if v_verdict = 'ALL' then
    v_verdict := null;
  end if;

  if v_verdict is not null and v_verdict not in ('CORRECT', 'WRONG_LABEL', 'UNREALISTIC_VALUE') then
    raise exception 'invalid_verdict';
  end if;

  return (
    with page_rows as (
      select
        ri.id,
        ri.dataset_id,
        ri.sample_row_id,
        ri.sample_key,
        ri.entity_type,
        ri.audit_record_id,
        ri.value,
        ri.start_offset,
        ri.end_offset,
        ri.verdict,
        ri.reason,
        ri.suggested_label,
        ri.replacement_value,
        ri.status,
        ri.decision,
        ri.reviewer_note,
        ri.decided_by,
        ri.decided_at,
        ri.version,
        ri.updated_at,
        ri.created_at
      from public.review_items ri
      join public.datasets d on d.id = ri.dataset_id
      where ri.dataset_id = v_dataset_id
        and ri.status = 'completed'
        and ri.decision is not null
        and private.is_project_member(d.project_id)
        and (v_entity_type is null or ri.entity_type = v_entity_type)
        and (v_verdict is null or ri.verdict = v_verdict)
        and (
          v_search is null
          or lower(
            coalesce(ri.value, '') || ' ' ||
            coalesce(ri.reason, '') || ' ' ||
            coalesce(ri.suggested_label, '') || ' ' ||
            coalesce(ri.entity_type, '') || ' ' ||
            coalesce(ri.sample_key, '')
          ) like '%' || v_search || '%'
        )
        and (
          v_after is null
          or (
            (
              coalesce(ri.decided_at, '-infinity'::timestamptz),
              ri.updated_at,
              ri.id
            ) < (
              coalesce(nullif(v_after ->> 'decided_at', '')::timestamptz, '-infinity'::timestamptz),
              (v_after ->> 'updated_at')::timestamptz,
              (v_after ->> 'id')::uuid
            )
          )
        )
      order by
        ri.decided_at desc nulls last,
        ri.updated_at desc,
        ri.id desc
      limit (v_limit + 1)
    ),
    numbered as (
      select
        row_number() over (
          order by
            decided_at desc nulls last,
            updated_at desc,
            id desc
        ) as page_row_number,
        page_rows.*
      from page_rows
    ),
    limited as (
      select *
      from numbered
      where page_row_number <= v_limit
    ),
    last_row as (
      select *
      from limited
      order by page_row_number desc
      limit 1
    )
    select jsonb_build_object(
      'items',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', id,
              'dataset_id', dataset_id,
              'sample_row_id', sample_row_id,
              'sample_key', sample_key,
              'entity_type', entity_type,
              'audit_record_id', audit_record_id,
              'value', value,
              'start_offset', start_offset,
              'end_offset', end_offset,
              'verdict', verdict,
              'reason', reason,
              'suggested_label', suggested_label,
              'replacement_value', replacement_value,
              'status', status,
              'decision', decision,
              'reviewer_note', reviewer_note,
              'decided_by', decided_by,
              'decided_at', decided_at,
              'version', version,
              'updated_at', updated_at,
              'created_at', created_at
            )
            order by page_row_number
          )
          from limited
        ),
        '[]'::jsonb
      ),
      'has_more',
      exists (select 1 from numbered where page_row_number > v_limit),
      'next_after',
      case
        when exists (select 1 from numbered where page_row_number > v_limit) then (
          select jsonb_build_object(
            'decided_at', to_jsonb(decided_at),
            'updated_at', updated_at,
            'id', id::text
          )
          from last_row
        )
        else null::jsonb
      end
    )
  );
end;
$$;

grant execute on function public.list_labeled_review_items_page(jsonb) to authenticated;

notify pgrst, 'reload schema';
