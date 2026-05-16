-- 012_import_dataset_entity_rpc.sql
-- Run after 009_import_dataset_rpc.sql.
-- Purpose:
--   Support staged browser imports. The UI can create/verify the shared
--   dataset with samples once, then import one entity per smaller request.

create or replace function public.import_dataset_entity_payload(
  p_project_id uuid,
  p_manifest jsonb,
  p_entity jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_dataset_id uuid;
  v_existing_metadata jsonb;
  v_existing_items boolean;
  v_source_key text;
  v_language text;
  v_folder text;
  v_entity_type text;
  v_inserted integer;
  v_deleted integer;
  v_missing_refs integer;
  v_sample_count integer;
  v_entity_result jsonb;
  v_import_event jsonb;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if not private.can_admin_project(p_project_id) then
    raise exception 'not_allowed';
  end if;

  if p_manifest is null or jsonb_typeof(p_manifest) <> 'object' then
    raise exception 'invalid_manifest';
  end if;

  if p_entity is null or jsonb_typeof(p_entity) <> 'object' then
    raise exception 'invalid_entity_payload';
  end if;

  v_source_key := nullif(coalesce(
    p_manifest #>> '{dataset,source_key}',
    p_manifest ->> 'source_key'
  ), '');
  v_language := nullif(coalesce(
    p_manifest #>> '{dataset,language}',
    p_manifest ->> 'language'
  ), '');
  v_folder := nullif(coalesce(
    p_manifest #>> '{dataset,folder}',
    p_manifest ->> 'folder'
  ), '');
  v_entity_type := nullif(p_entity ->> 'entity_type', '');

  if v_source_key is null then
    raise exception 'missing_source_key';
  end if;

  if v_language is null then
    raise exception 'missing_language';
  end if;

  if v_entity_type is null then
    raise exception 'missing_entity_type';
  end if;

  if jsonb_typeof(p_entity -> 'review_rows') <> 'array' then
    raise exception 'invalid_review_rows';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_entity -> 'review_rows') as payload(row)
    where payload.row ->> 'sample_index' is null
       or (payload.row ->> 'sample_index') !~ '^\d+$'
       or nullif(payload.row ->> 'value', '') is null
  ) then
    raise exception 'invalid_review_row';
  end if;

  select d.id, d.metadata
  into v_dataset_id, v_existing_metadata
  from public.datasets d
  where d.project_id = p_project_id
    and d.language = v_language
    and coalesce(d.folder, '') = coalesce(v_folder, '')
    and d.source_key = v_source_key
  for update;

  if v_dataset_id is null then
    raise exception 'dataset_not_found_for_entity_import';
  end if;

  select count(*)
  into v_sample_count
  from public.review_samples s
  where s.dataset_id = v_dataset_id;

  select exists (
    select 1
    from public.review_items ri
    where ri.dataset_id = v_dataset_id
      and ri.entity_type = v_entity_type
    limit 1
  )
  into v_existing_items;

  if v_existing_items and not p_replace then
    raise exception 'entity_import_exists:%', v_entity_type;
  end if;

  if p_replace then
    delete from public.review_items ri
    where ri.dataset_id = v_dataset_id
      and ri.entity_type = v_entity_type;
    get diagnostics v_deleted = row_count;
  else
    v_deleted := 0;
  end if;

  select count(*)
  into v_missing_refs
  from jsonb_array_elements(p_entity -> 'review_rows') as payload(row)
  left join public.review_samples s
    on s.dataset_id = v_dataset_id
   and s.sample_index = (payload.row ->> 'sample_index')::integer
  where s.id is null;

  if v_missing_refs > 0 then
    raise exception 'review_rows_reference_missing_samples:%', v_entity_type;
  end if;

  insert into public.review_items (
    dataset_id,
    sample_row_id,
    sample_key,
    entity_type,
    audit_record_id,
    value,
    start_offset,
    end_offset,
    verdict,
    reason,
    suggested_label,
    replacement_value,
    raw_audit,
    raw_export_span
  )
  select
    v_dataset_id,
    s.id,
    s.sample_key,
    v_entity_type,
    nullif(payload.row ->> 'audit_record_id', '')::integer,
    payload.row ->> 'value',
    nullif(payload.row ->> 'start_offset', '')::integer,
    nullif(payload.row ->> 'end_offset', '')::integer,
    payload.row ->> 'verdict',
    nullif(payload.row ->> 'reason', ''),
    nullif(payload.row ->> 'suggested_label', ''),
    nullif(payload.row ->> 'replacement_value', ''),
    coalesce(payload.row -> 'raw_audit', '{}'::jsonb),
    coalesce(payload.row -> 'raw_export_span', '{}'::jsonb)
  from jsonb_array_elements(p_entity -> 'review_rows') as payload(row)
  join public.review_samples s
    on s.dataset_id = v_dataset_id
   and s.sample_index = (payload.row ->> 'sample_index')::integer
  on conflict do nothing;

  get diagnostics v_inserted = row_count;

  v_entity_result := jsonb_build_object(
    'entity_type', v_entity_type,
    'deleted_review_items', v_deleted,
    'inserted_review_items', v_inserted,
    'payload_review_items', jsonb_array_length(p_entity -> 'review_rows'),
    'replaced', p_replace and v_existing_items
  );

  v_import_event := jsonb_build_object(
    'imported_at', now(),
    'imported_by', v_user,
    'replace', p_replace,
    'staged', true,
    'manifest', p_manifest,
    'sample_count', v_sample_count,
    'entities', jsonb_build_array(v_entity_result)
  );

  update public.datasets d
  set metadata = coalesce(d.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'manifest', p_manifest,
      'latest_import', v_import_event,
      'import_history', coalesce(d.metadata -> 'import_history', '[]'::jsonb)
        || jsonb_build_array(v_import_event)
    )
  where d.id = v_dataset_id;

  insert into public.audit_events (
    project_id,
    dataset_id,
    actor_id,
    action,
    after_state
  )
  values (
    p_project_id,
    v_dataset_id,
    v_user,
    'dataset_entity_imported',
    v_import_event
  );

  return jsonb_build_object(
    'dataset_id', v_dataset_id,
    'dataset_created', false,
    'sample_count', v_sample_count,
    'entities', jsonb_build_array(v_entity_result),
    'warnings', '[]'::jsonb
  );
end;
$$;

grant execute on function public.import_dataset_entity_payload(uuid, jsonb, jsonb, boolean) to authenticated;