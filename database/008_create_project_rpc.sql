-- 008_create_project_rpc.sql
-- Run after 002_rls_policies.sql.
-- Purpose:
--   Allow existing project owners/admins to create additional projects from
--   the admin UI. The creator is automatically added as project owner.

create or replace function private.can_admin_project(p_project_id uuid)
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
      and pm.role in ('owner', 'admin')
  );
$$;

create or replace function public.create_project(
  p_slug text,
  p_name text,
  p_description text default null
)
returns public.labeling_projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_project public.labeling_projects;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1
    from public.project_members pm
    where pm.user_id = v_user
      and pm.role in ('owner', 'admin')
  ) then
    raise exception 'not_allowed';
  end if;

  p_slug := lower(trim(p_slug));
  p_name := trim(p_name);
  p_description := nullif(trim(coalesce(p_description, '')), '');

  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9_-]*$' then
    raise exception 'invalid_project_slug';
  end if;

  if p_name is null or length(p_name) = 0 then
    raise exception 'invalid_project_name';
  end if;

  insert into public.labeling_projects (slug, name, description, created_by)
  values (p_slug, p_name, p_description, v_user)
  returning * into v_project;

  insert into public.project_members (project_id, user_id, role)
  values (v_project.id, v_user, 'owner');

  return v_project;
exception
  when unique_violation then
    raise exception 'project_slug_exists';
end;
$$;

grant execute on function private.can_admin_project(uuid) to authenticated;
grant execute on function public.create_project(text, text, text) to authenticated;
