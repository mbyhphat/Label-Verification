-- 011_update_review_sample_mask_rpc.sql
-- Purpose:
--   Persist sample-level source text and privacy_mask edits without completing
--   an individual review item. This lets reviewers fix the overall labeling result while
--   preserving the existing lock/version/audit workflow.

drop function if exists public.update_review_sample_mask(uuid, integer, jsonb);
drop function if exists public.update_review_sample_mask(uuid, integer, jsonb, text);

create or replace function public.update_review_sample_mask(
  p_sample_id uuid,
  p_sample_version integer,
  p_new_privacy_mask jsonb,
  p_new_source_text text default null
)
returns public.review_samples
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_sample public.review_samples;
  v_before jsonb;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if p_new_privacy_mask is null or jsonb_typeof(p_new_privacy_mask) <> 'array' then
    raise exception 'invalid_privacy_mask';
  end if;

  select *
  into v_sample
  from public.review_samples
  where id = p_sample_id
  for update;

  if not found then
    raise exception 'sample_not_found';
  end if;

  select d.project_id
  into v_project_id
  from public.datasets d
  where d.id = v_sample.dataset_id;

  if not private.can_edit_project(v_project_id) then
    raise exception 'not_allowed';
  end if;

  if v_sample.version <> p_sample_version then
    raise exception 'stale_version';
  end if;

  if v_sample.locked_by is distinct from v_user
     or coalesce(v_sample.locked_until, '-infinity'::timestamptz) < now() then
    raise exception 'lock_required';
  end if;

  if v_sample.current_source_text is not distinct from coalesce(p_new_source_text, v_sample.current_source_text)
     and v_sample.current_privacy_mask is not distinct from p_new_privacy_mask then
    return v_sample;
  end if;

  v_before := to_jsonb(v_sample);

  update public.review_samples
  set current_source_text = coalesce(p_new_source_text, current_source_text),
      current_privacy_mask = p_new_privacy_mask,
      version = version + 1,
      updated_by = v_user,
      updated_at = now()
  where id = p_sample_id
  returning * into v_sample;

  insert into public.audit_events (
    project_id,
    dataset_id,
    sample_row_id,
    actor_id,
    action,
    before_state,
    after_state
  )
  values (
    v_project_id,
    v_sample.dataset_id,
    v_sample.id,
    v_user,
    'sample_text_mask_updated',
    v_before,
    to_jsonb(v_sample)
  );

  return v_sample;
end;
$$;

grant execute on function public.update_review_sample_mask(uuid, integer, jsonb, text) to authenticated;
