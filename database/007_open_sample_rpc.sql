-- 007_open_sample_rpc.sql
-- Run after 003_rpc_functions.sql.
-- Purpose:
--   Provide a single-round-trip alternative to the two-step
--   getReviewBundle (SELECT sample + SELECT items) + acquire_sample_lock (UPDATE) flow.
--
--   open_sample(p_sample_id, p_ttl_seconds) atomically:
--     1. Verifies authentication and project membership.
--     2. Acquires (or refreshes) the lock on the sample row.
--     3. Returns the locked sample row + all its review_items as JSON.
--
--   Design notes:
--   - No p_expected_version check: the caller does not hold a prior version
--     (they are opening for the first time), so the optimistic concurrency
--     guard is intentionally omitted here.
--   - Lock-conflict guard is still enforced: if another user holds a
--     non-expired lock the call raises 'lock_conflict'.
--   - submit_review_decision still enforces p_sample_version, so write
--     operations remain protected against concurrent edits.
--   - Audit logging mirrors acquire_sample_lock: a 'lock_acquired' event
--     is inserted only when transitioning from another user's lock (or no lock).

create or replace function public.open_sample(
  p_sample_id  uuid,
  p_ttl_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       uuid := auth.uid();
  v_project_id uuid;
  v_dataset_id uuid;
  v_before     jsonb;
  v_sample     public.review_samples;
  v_items      jsonb;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  -- Fetch project/dataset context and capture before-state for audit.
  select d.project_id, s.dataset_id, to_jsonb(s)
  into   v_project_id, v_dataset_id, v_before
  from   public.review_samples s
  join   public.datasets d on d.id = s.dataset_id
  where  s.id = p_sample_id;

  if v_project_id is null then
    raise exception 'sample_not_found';
  end if;

  if not private.can_edit_project(v_project_id) then
    raise exception 'not_allowed';
  end if;

  -- Acquire lock atomically. Allow if:
  --   • row is unlocked, OR
  --   • same user already holds the lock (refresh), OR
  --   • the existing lock has expired.
  update public.review_samples s
  set    locked_by    = v_user,
         locked_until = now() + make_interval(secs => least(greatest(p_ttl_seconds, 30), 300)),
         updated_at   = now()
  where  s.id = p_sample_id
    and  (
           s.locked_by is null
           or s.locked_by = v_user
           or coalesce(s.locked_until, '-infinity'::timestamptz) < now()
         )
  returning * into v_sample;

  if not found then
    raise exception 'lock_conflict';
  end if;

  -- Audit: only log when the lock transfers to this user.
  if coalesce(v_before->>'locked_by', '') <> v_user::text then
    insert into public.audit_events (
      project_id, dataset_id, sample_row_id, actor_id, action, before_state, after_state
    )
    values (
      v_project_id, v_dataset_id, p_sample_id, v_user,
      'lock_acquired', v_before, to_jsonb(v_sample)
    );
  end if;

  -- Fetch all review items for this sample ordered for consistent display.
  select coalesce(
    jsonb_agg(to_jsonb(i) order by i.audit_record_id),
    '[]'::jsonb
  )
  into v_items
  from public.review_items i
  where i.sample_row_id = p_sample_id;

  return jsonb_build_object('sample', to_jsonb(v_sample), 'items', v_items);
end;
$$;

grant execute on function public.open_sample(uuid, integer) to authenticated;
