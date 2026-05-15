-- 002_rls_policies.sql
-- Run after 001_schema.sql.
-- Purpose:
--   Protect all public tables with project-membership Row Level Security.
--   This file creates membership helper functions, enables RLS,
--   adds read policies, and grants authenticated users read-only table access.
--   Frontend writes intentionally go through RPC functions from 003_rpc_functions.sql.

create or replace function private.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
  );
$$;

create or replace function private.can_edit_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'reviewer')
  );
$$;

alter table public.labeling_projects enable row level security;
alter table public.project_members enable row level security;
alter table public.datasets enable row level security;
alter table public.review_samples enable row level security;
alter table public.review_items enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists "members can read projects" on public.labeling_projects;
create policy "members can read projects"
on public.labeling_projects for select
to authenticated
using (private.is_project_member(id));

drop policy if exists "members can read memberships" on public.project_members;
create policy "members can read memberships"
on public.project_members for select
to authenticated
using (private.is_project_member(project_id));

drop policy if exists "members can read datasets" on public.datasets;
create policy "members can read datasets"
on public.datasets for select
to authenticated
using (private.is_project_member(project_id));

drop policy if exists "members can read samples" on public.review_samples;
create policy "members can read samples"
on public.review_samples for select
to authenticated
using (
  exists (
    select 1
    from public.datasets d
    where d.id = dataset_id
      and private.is_project_member(d.project_id)
  )
);

drop policy if exists "members can read review items" on public.review_items;
create policy "members can read review items"
on public.review_items for select
to authenticated
using (
  exists (
    select 1
    from public.datasets d
    where d.id = dataset_id
      and private.is_project_member(d.project_id)
  )
);

drop policy if exists "members can read audit events" on public.audit_events;
create policy "members can read audit events"
on public.audit_events for select
to authenticated
using (private.is_project_member(project_id));

revoke all on public.labeling_projects, public.project_members, public.datasets,
  public.review_samples, public.review_items, public.audit_events from anon, authenticated;

grant select on public.labeling_projects, public.project_members, public.datasets,
  public.review_samples, public.review_items, public.audit_events to authenticated;

grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;
