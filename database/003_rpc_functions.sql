-- 003_rpc_functions.sql
-- Run after 002_rls_policies.sql.
-- Purpose:
--   Create the frontend's safe write API.
--   These RPC functions acquire/release sample locks and submit decisions
--   while enforcing authentication, project roles, optimistic version checks,
--   atomic sample/item updates, and audit logging.

create or replace function public.acquire_sample_lock(
  p_sample_id uuid,
  p_expected_version integer,
  p_ttl_seconds integer default 180
)
returns public.review_samples
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_dataset_id uuid;
  v_before jsonb;
  v_sample public.review_samples;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select d.project_id, s.dataset_id, to_jsonb(s)
  into v_project_id, v_dataset_id, v_before
  from public.review_samples s
  join public.datasets d on d.id = s.dataset_id
  where s.id = p_sample_id;

  if v_project_id is null then
    raise exception 'sample_not_found';
  end if;

  if not private.can_edit_project(v_project_id) then
    raise exception 'not_allowed';
  end if;

  update public.review_samples s
  set locked_by = v_user,
      locked_until = now() + make_interval(secs => least(greatest(p_ttl_seconds, 30), 300)),
      updated_at = now()
  where s.id = p_sample_id
    and s.version = p_expected_version
    and (
      s.locked_by is null
      or s.locked_by = v_user
      or coalesce(s.locked_until, '-infinity'::timestamptz) < now()
    )
  returning * into v_sample;

  if not found then
    raise exception 'lock_conflict_or_stale_version';
  end if;

  if coalesce(v_before->>'locked_by', '') <> v_user::text then
    insert into public.audit_events (
      project_id, dataset_id, sample_row_id, actor_id, action, before_state, after_state
    )
    values (
      v_project_id, v_dataset_id, p_sample_id, v_user, 'lock_acquired', v_before, to_jsonb(v_sample)
    );
  end if;

  return v_sample;
end;
$$;

create or replace function public.release_sample_lock(p_sample_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_dataset_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select d.project_id, s.dataset_id, to_jsonb(s)
  into v_project_id, v_dataset_id, v_before
  from public.review_samples s
  join public.datasets d on d.id = s.dataset_id
  where s.id = p_sample_id;

  if v_project_id is null or not private.can_edit_project(v_project_id) then
    raise exception 'not_allowed';
  end if;

  update public.review_samples s
  set locked_by = null,
      locked_until = null,
      updated_at = now()
  where s.id = p_sample_id
    and s.locked_by = v_user
  returning to_jsonb(s) into v_after;

  if v_after is not null then
    insert into public.audit_events (
      project_id, dataset_id, sample_row_id, actor_id, action, before_state, after_state
    )
    values (
      v_project_id, v_dataset_id, p_sample_id, v_user, 'lock_released', v_before, v_after
    );
  end if;
end;
$$;

create or replace function public.submit_review_decision(
  p_review_item_id uuid,
  p_sample_version integer,
  p_item_version integer,
  p_decision text,
  p_reviewer_note text default null,
  p_new_source_text text default null,
  p_new_privacy_mask jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_project_id uuid;
  v_item public.review_items;
  v_sample public.review_samples;
  v_before jsonb;
  v_after jsonb;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if p_decision not in ('accept', 'deny', 'deny_keep', 'deny_remove') then
    raise exception 'invalid_decision';
  end if;

  if p_new_privacy_mask is not null and jsonb_typeof(p_new_privacy_mask) <> 'array' then
    raise exception 'invalid_privacy_mask';
  end if;

  select *
  into v_item
  from public.review_items
  where id = p_review_item_id
  for update;

  if not found then
    raise exception 'review_item_not_found';
  end if;

  select *
  into v_sample
  from public.review_samples
  where id = v_item.sample_row_id
  for update;

  select d.project_id
  into v_project_id
  from public.datasets d
  where d.id = v_item.dataset_id;

  if not private.can_edit_project(v_project_id) then
    raise exception 'not_allowed';
  end if;

  if v_sample.version <> p_sample_version or v_item.version <> p_item_version then
    raise exception 'stale_version';
  end if;

  if v_sample.locked_by is distinct from v_user
     or coalesce(v_sample.locked_until, '-infinity'::timestamptz) < now() then
    raise exception 'lock_required';
  end if;

  v_before := jsonb_build_object('sample', to_jsonb(v_sample), 'item', to_jsonb(v_item));

  update public.review_items
  set status = 'completed',
      decision = p_decision,
      reviewer_note = p_reviewer_note,
      decided_by = v_user,
      decided_at = now(),
      version = version + 1,
      updated_at = now()
  where id = v_item.id
  returning * into v_item;

  update public.review_samples
  set current_source_text = coalesce(p_new_source_text, current_source_text),
      current_privacy_mask = coalesce(p_new_privacy_mask, current_privacy_mask),
      version = version + 1,
      locked_by = null,
      locked_until = null,
      updated_by = v_user,
      updated_at = now()
  where id = v_sample.id
  returning * into v_sample;

  v_after := jsonb_build_object('sample', to_jsonb(v_sample), 'item', to_jsonb(v_item));

  insert into public.audit_events (
    project_id, dataset_id, sample_row_id, review_item_id,
    actor_id, action, before_state, after_state
  )
  values (
    v_project_id, v_item.dataset_id, v_sample.id, v_item.id,
    v_user, 'decision_submitted', v_before, v_after
  );

  return v_after;
end;
$$;

grant execute on function public.acquire_sample_lock(uuid, integer, integer) to authenticated;
grant execute on function public.release_sample_lock(uuid) to authenticated;
grant execute on function public.submit_review_decision(uuid, integer, integer, text, text, text, jsonb) to authenticated;
