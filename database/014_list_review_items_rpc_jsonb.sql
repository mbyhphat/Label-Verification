-- 014_list_review_items_rpc_jsonb.sql
-- Replaces the SETOF-returning list_review_items (013) with a jsonb-returning
-- variant so that PostgREST's 1000-row cap is bypassed entirely.
-- The function now returns a single jsonb row (the full array), which PostgREST
-- passes through without truncation.

drop function if exists public.list_review_items(uuid);

create or replace function public.list_review_items(p_dataset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',                ri.id,
        'dataset_id',        ri.dataset_id,
        'sample_row_id',     ri.sample_row_id,
        'sample_key',        ri.sample_key,
        'entity_type',       ri.entity_type,
        'audit_record_id',   ri.audit_record_id,
        'value',             ri.value,
        'start_offset',      ri.start_offset,
        'end_offset',        ri.end_offset,
        'verdict',           ri.verdict,
        'reason',            ri.reason,
        'suggested_label',   ri.suggested_label,
        'replacement_value', ri.replacement_value,
        'status',            ri.status,
        'decision',          ri.decision,
        'reviewer_note',     ri.reviewer_note,
        'decided_by',        ri.decided_by,
        'decided_at',        ri.decided_at,
        'version',           ri.version,
        'updated_at',        ri.updated_at,
        'created_at',        ri.created_at
      )
      order by
        ri.status desc,
        ri.entity_type asc,
        ri.sample_key asc,
        ri.audit_record_id asc
    ),
    '[]'::jsonb
  )
  from public.review_items ri
  join public.datasets d on d.id = ri.dataset_id
  where ri.dataset_id = p_dataset_id
    and private.is_project_member(d.project_id)
$$;

grant execute on function public.list_review_items(uuid) to authenticated;
