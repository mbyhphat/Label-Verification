-- 013_list_review_items_rpc.sql
-- Run after 002_rls_policies.sql (and prior RPC migrations).
-- Purpose:
--   Return all review_items for a dataset in a single round trip, bypassing
--   PostgREST's default 1000-row max and avoiding per-row RLS evaluation on
--   the client query path. Omits heavy JSON blobs (raw_audit, raw_export_span)
--   that the list view never uses; modal detail comes from open_sample.

create or replace function public.list_review_items(p_dataset_id uuid)
returns table (
  id uuid,
  dataset_id uuid,
  sample_row_id uuid,
  sample_key text,
  entity_type text,
  audit_record_id integer,
  value text,
  start_offset integer,
  end_offset integer,
  verdict text,
  reason text,
  suggested_label text,
  replacement_value text,
  status text,
  decision text,
  reviewer_note text,
  decided_by uuid,
  decided_at timestamptz,
  version integer,
  updated_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
  where ri.dataset_id = p_dataset_id
    and private.is_project_member(d.project_id)
  order by
    ri.status desc,
    ri.entity_type asc,
    ri.sample_key asc,
    ri.audit_record_id asc
$$;

grant execute on function public.list_review_items(uuid) to authenticated;
