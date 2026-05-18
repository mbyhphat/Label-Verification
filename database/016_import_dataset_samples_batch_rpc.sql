-- 016_import_dataset_samples_batch_rpc.sql
-- Run after 012_import_dataset_entity_rpc.sql.
-- Purpose:
--   Import large samples.json files in smaller RPC chunks to avoid Edge Function /
--   PostgREST payload limits and statement timeouts.

create or replace function public.import_dataset_samples_batch(
  p_project_id uuid,
  p_manifest jsonb,
  p_samples jsonb,
  p_chunk_offset integer,
  p_total_sample_count integer,
  p_finalize boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_dataset_id uuid;
  v_dataset_created boolean := false;
  v_existing_metadata jsonb;
  v_existing_sample_count integer;
  v_source_key text;
  v_language text;
  v_folder text;
  v_sample_key_prefix text;
  v_samples_sha256 text;
  v_chunk_count integer;
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

  if p_samples is null or jsonb_typeof(p_samples) <> 'array' then
    raise exception 'invalid_samples';
  end if;

  if p_chunk_offset is null or p_chunk_offset < 0 then
    raise exception 'invalid_chunk_offset';
  end if;

  if p_total_sample_count is null or p_total_sample_count < 1 then
    raise exception 'invalid_total_sample_count';
  end if;

  v_chunk_count := jsonb_array_length(p_samples);
  if v_chunk_count = 0 then
    raise exception 'empty_samples';
  end if;

  if p_chunk_offset + v_chunk_count > p_total_sample_count then
    raise exception 'chunk_exceeds_total_sample_count';
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
  v_sample_key_prefix := nullif(coalesce(
    p_manifest #>> '{dataset,sample_key_prefix}',
    p_manifest ->> 'sample_key_prefix',
    v_source_key
  ), '');
  v_samples_sha256 := nullif(coalesce(
    p_manifest #>> '{files,samples_sha256}',
    p_manifest #>> '{checksums,samples_sha256}'
  ), '');

  if v_source_key is null then
    raise exception 'missing_source_key';
  end if;

  if v_language is null then
    raise exception 'missing_language';
  end if;

  if v_sample_key_prefix is null then
    raise exception 'missing_sample_key_prefix';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_samples) with ordinality as incoming(sample, ord)
    where nullif(incoming.sample ->> 'source_text', '') is null
  ) then
    raise exception 'sample_missing_source_text';
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
    if p_chunk_offset <> 0 then
      raise exception 'dataset_missing_for_chunk';
    end if;

    insert into public.datasets (
      project_id,
      source_key,
      entity_type,
      language,
      folder,
      metadata,
      created_by
    )
    values (
      p_project_id,
      v_source_key,
      'MULTI_ENTITY',
      v_language,
      v_folder,
      jsonb_build_object(
        'manifest', p_manifest,
        'source_files', jsonb_build_object('samples_sha256', v_samples_sha256),
        'import_history', '[]'::jsonb
      ),
      v_user
    )
    returning id into v_dataset_id;

    v_dataset_created := true;
  else
    select count(*)
    into v_existing_sample_count
    from public.review_samples s
    where s.dataset_id = v_dataset_id;

    if v_existing_sample_count <> p_chunk_offset then
      raise exception 'chunk_offset_mismatch:%:%', v_existing_sample_count, p_chunk_offset;
    end if;

    if p_chunk_offset = 0 and v_existing_sample_count > 0 then
      if v_existing_sample_count <> p_total_sample_count then
        raise exception 'sample_count_changed';
      end if;
    end if;
  end if;

  insert into public.review_samples (
    dataset_id,
    sample_index,
    sample_key,
    language,
    original_source_text,
    current_source_text,
    original_privacy_mask,
    current_privacy_mask,
    raw_output
  )
  select
    v_dataset_id,
    p_chunk_offset + incoming.ord::integer - 1,
    v_sample_key_prefix || '#' || (p_chunk_offset + incoming.ord::integer - 1)::text,
    coalesce(nullif(incoming.sample ->> 'language', ''), v_language),
    incoming.sample ->> 'source_text',
    incoming.sample ->> 'source_text',
    case
      when jsonb_typeof(incoming.sample -> 'privacy_mask') = 'array'
        then incoming.sample -> 'privacy_mask'
      else '[]'::jsonb
    end,
    case
      when jsonb_typeof(incoming.sample -> 'privacy_mask') = 'array'
        then incoming.sample -> 'privacy_mask'
      else '[]'::jsonb
    end,
    incoming.sample
  from jsonb_array_elements(p_samples) with ordinality as incoming(sample, ord);

  if p_finalize then
    select count(*)
    into v_existing_sample_count
    from public.review_samples s
    where s.dataset_id = v_dataset_id;

    if v_existing_sample_count <> p_total_sample_count then
      raise exception 'sample_count_changed';
    end if;

    v_import_event := jsonb_build_object(
      'imported_at', now(),
      'imported_by', v_user,
      'replace', false,
      'manifest', p_manifest,
      'sample_count', p_total_sample_count,
      'entities', '[]'::jsonb,
      'import_mode', 'samples_batch'
    );

    update public.datasets d
    set metadata = coalesce(d.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'manifest', p_manifest,
        'source_files', coalesce(d.metadata -> 'source_files', '{}'::jsonb)
          || jsonb_build_object('samples_sha256', v_samples_sha256),
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
      'dataset_imported',
      v_import_event
    );
  end if;

  return jsonb_build_object(
    'dataset_id', v_dataset_id,
    'dataset_created', v_dataset_created,
    'sample_count', p_total_sample_count,
    'chunk_offset', p_chunk_offset,
    'chunk_count', v_chunk_count,
    'entities', '[]'::jsonb,
    'warnings', '[]'::jsonb
  );
end;
$$;

grant execute on function public.import_dataset_samples_batch(
  uuid,
  jsonb,
  jsonb,
  integer,
  integer,
  boolean
) to authenticated;
