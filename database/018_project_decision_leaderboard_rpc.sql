-- 018_project_decision_leaderboard_rpc.sql
-- Run after 015_project_class_statistics_rpc.sql.
-- Purpose:
--   Give project owners/admins an account-level leaderboard for current
--   completed review decisions without exposing user emails to non-admins.

create index if not exists review_items_completed_decider_idx
on public.review_items(dataset_id, decided_by, decided_at desc)
where status = 'completed'
  and decision is not null
  and decided_by is not null;

create or replace function public.list_project_decision_leaderboard(p_project_id uuid)
returns table (
  user_id uuid,
  email text,
  role text,
  decide_count bigint,
  last_decided_at timestamptz
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
  with decision_counts as (
    select
      ri.decided_by as user_id,
      count(*)::bigint as decide_count,
      max(ri.decided_at) as last_decided_at
    from public.review_items ri
    join public.datasets d on d.id = ri.dataset_id
    where d.project_id = p_project_id
      and ri.status = 'completed'
      and ri.decision is not null
      and ri.decided_by is not null
    group by ri.decided_by
  ),
  leaderboard_users as (
    select pm.user_id
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.role in ('owner', 'admin', 'reviewer')

    union

    select dc.user_id
    from decision_counts dc
  )
  select
    leaderboard_users.user_id,
    users.email::text as email,
    pm.role,
    coalesce(decision_counts.decide_count, 0)::bigint as decide_count,
    decision_counts.last_decided_at
  from leaderboard_users
  left join decision_counts
    on decision_counts.user_id = leaderboard_users.user_id
  left join public.project_members pm
    on pm.project_id = p_project_id
   and pm.user_id = leaderboard_users.user_id
  left join auth.users users
    on users.id = leaderboard_users.user_id
  order by
    coalesce(decision_counts.decide_count, 0) desc,
    decision_counts.last_decided_at desc nulls last,
    users.email nulls last,
    leaderboard_users.user_id;
end;
$$;

grant execute on function public.list_project_decision_leaderboard(uuid) to authenticated;
