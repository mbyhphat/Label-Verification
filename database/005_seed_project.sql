-- 005_seed_project.sql
-- Run after you create your first Supabase Auth user.
-- Purpose:
--   Bootstrap the first project and owner membership.
--   Replace <your-auth-user-id> with the UUID from Authentication -> Users,
--   then run this in Supabase SQL Editor after 001-004 are complete.

with project as (
  insert into public.labeling_projects (slug, name, description)
  values (
    'pii-verification',
    'PII Verification',
    'Internal workspace for collaborative PII dataset verification'
  )
  on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description
  returning id
)
insert into public.project_members (project_id, user_id, role)
select id, '<your-auth-user-id>'::uuid, 'owner'
from project
on conflict (project_id, user_id) do update
set role = excluded.role;
