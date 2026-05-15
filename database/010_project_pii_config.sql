-- 010_project_pii_config.sql
-- Run after 009_import_dataset_rpc.sql.
-- Purpose:
--   Store the default PII entity catalog from entity_types.json and let
--   project owners/admins configure which classes are required per project.

create table if not exists public.pii_entity_types (
  entity_type text primary key check (entity_type ~ '^[A-Z0-9_]+$'),
  sort_order integer not null unique check (sort_order > 0),
  created_at timestamptz not null default now()
);

insert into public.pii_entity_types (sort_order, entity_type)
values
  (1, 'PREFIX'),
  (2, 'PERSONAL_NAME'),
  (3, 'SEX'),
  (4, 'AGE'),
  (5, 'DOB'),
  (6, 'PHONE_NUMBER'),
  (7, 'EMAIL'),
  (8, 'LOCATION'),
  (9, 'STREET_ADDRESS'),
  (10, 'ZIPCODE'),
  (11, 'GPS_COORDINATE'),
  (12, 'USERNAME'),
  (13, 'PASSWORD'),
  (14, 'PIN'),
  (15, 'URL'),
  (16, 'IP_ADDRESS'),
  (17, 'ACCOUNT_NUMBER'),
  (18, 'AMOUNT'),
  (19, 'CREDIT_CARD_ISSUER'),
  (20, 'CREDIT_CARD_NUMBER'),
  (21, 'CREDIT_CARD_CVV'),
  (22, 'IBAN'),
  (23, 'BIC_SWIFT'),
  (24, 'CRYPTO_ADDRESS'),
  (25, 'OCCUPATION'),
  (26, 'SSN_CCCD'),
  (27, 'PASSPORT_NUM'),
  (28, 'DRIVER_LICENSE'),
  (29, 'TAX_ID'),
  (30, 'DATE'),
  (31, 'TIME'),
  (32, 'MARITAL_STATUS'),
  (33, 'RELIGION'),
  (34, 'ETHNICITY'),
  (35, 'TRADE_UNION_INFO'),
  (36, 'NATIONALITY'),
  (37, 'HEALTH_INSURANCE'),
  (38, 'HEALTH_STATUS')
on conflict (entity_type) do update
set sort_order = excluded.sort_order;

create table if not exists public.project_pii_configs (
  project_id uuid primary key references public.labeling_projects(id) on delete cascade,
  required_entity_types text[] not null,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (array_length(required_entity_types, 1) > 0)
);

create or replace function private.default_pii_entity_types()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(entity_type order by sort_order), '{}'::text[])
  from public.pii_entity_types;
$$;

create or replace function private.normalize_pii_entity_types(p_entity_types text[])
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_requested_count integer;
  v_invalid_count integer;
  v_normalized text[];
begin
  if p_entity_types is null then
    raise exception 'missing_entity_types';
  end if;

  select count(*)
  into v_requested_count
  from (
    select distinct upper(trim(raw.value)) as entity_type
    from unnest(p_entity_types) as raw(value)
    where nullif(trim(raw.value), '') is not null
  ) requested;

  if v_requested_count = 0 then
    raise exception 'empty_entity_types';
  end if;

  select count(*)
  into v_invalid_count
  from (
    select distinct upper(trim(raw.value)) as entity_type
    from unnest(p_entity_types) as raw(value)
    where nullif(trim(raw.value), '') is not null
  ) requested
  where requested.entity_type !~ '^[A-Z0-9_]+$';

  if v_invalid_count > 0 then
    raise exception 'invalid_entity_type_name';
  end if;

  select array_agg(requested.entity_type order by coalesce(c.sort_order, 100000), requested.entity_type)
  into v_normalized
  from (
    select distinct upper(trim(raw.value)) as entity_type
    from unnest(p_entity_types) as raw(value)
    where nullif(trim(raw.value), '') is not null
  ) requested
  left join public.pii_entity_types c
    on c.entity_type = requested.entity_type;

  return v_normalized;
end;
$$;

create or replace function public.get_project_pii_config(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_required text[];
  v_updated_at timestamptz;
  v_is_default boolean := false;
  v_catalog jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not private.is_project_member(p_project_id) then
    raise exception 'not_allowed';
  end if;

  select c.required_entity_types, c.updated_at
  into v_required, v_updated_at
  from public.project_pii_configs c
  where c.project_id = p_project_id;

  if v_required is null then
    v_required := private.default_pii_entity_types();
    v_is_default := true;
  end if;

  with catalog as (
    select c.entity_type, c.sort_order
    from public.pii_entity_types c
    union all
    select custom.entity_type, 100000 + custom.ordinality::integer
    from unnest(v_required) with ordinality as custom(entity_type, ordinality)
    where not exists (
      select 1
      from public.pii_entity_types c
      where c.entity_type = custom.entity_type
    )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entity_type', catalog.entity_type,
        'sort_order', catalog.sort_order
      )
      order by catalog.sort_order, catalog.entity_type
    ),
    '[]'::jsonb
  )
  into v_catalog
  from catalog;

  return jsonb_build_object(
    'project_id', p_project_id,
    'catalog', v_catalog,
    'required_entity_types', to_jsonb(v_required),
    'required_entity_count', coalesce(array_length(v_required, 1), 0),
    'is_default', v_is_default,
    'updated_at', v_updated_at
  );
end;
$$;

create or replace function public.update_project_pii_config(
  p_project_id uuid,
  p_required_entity_types text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_required text[];
  v_before jsonb;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if not private.can_admin_project(p_project_id) then
    raise exception 'not_allowed';
  end if;

  v_required := private.normalize_pii_entity_types(p_required_entity_types);

  select to_jsonb(c)
  into v_before
  from public.project_pii_configs c
  where c.project_id = p_project_id;

  insert into public.project_pii_configs (
    project_id,
    required_entity_types,
    created_by,
    updated_by
  )
  values (
    p_project_id,
    v_required,
    v_user,
    v_user
  )
  on conflict (project_id) do update
  set required_entity_types = excluded.required_entity_types,
      updated_by = excluded.updated_by,
      updated_at = now();

  insert into public.audit_events (
    project_id,
    actor_id,
    action,
    before_state,
    after_state
  )
  values (
    p_project_id,
    v_user,
    'project_pii_config_updated',
    v_before,
    jsonb_build_object(
      'project_id', p_project_id,
      'required_entity_types', v_required,
      'required_entity_count', coalesce(array_length(v_required, 1), 0)
    )
  );

  return public.get_project_pii_config(p_project_id);
end;
$$;

create or replace function public.initialize_project_pii_config()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.project_pii_configs (
    project_id,
    required_entity_types,
    created_by,
    updated_by
  )
  values (
    new.id,
    private.default_pii_entity_types(),
    new.created_by,
    new.created_by
  )
  on conflict (project_id) do nothing;

  return new;
end;
$$;

drop trigger if exists initialize_project_pii_config on public.labeling_projects;
create trigger initialize_project_pii_config
after insert on public.labeling_projects
for each row execute function public.initialize_project_pii_config();

insert into public.project_pii_configs (
  project_id,
  required_entity_types,
  created_by,
  updated_by
)
select
  p.id,
  private.default_pii_entity_types(),
  p.created_by,
  p.created_by
from public.labeling_projects p
on conflict (project_id) do nothing;

alter table public.pii_entity_types enable row level security;
alter table public.project_pii_configs enable row level security;

drop policy if exists "authenticated can read pii entity types" on public.pii_entity_types;
create policy "authenticated can read pii entity types"
on public.pii_entity_types for select
to authenticated
using (true);

drop policy if exists "members can read project pii config" on public.project_pii_configs;
create policy "members can read project pii config"
on public.project_pii_configs for select
to authenticated
using (private.is_project_member(project_id));

revoke all on public.pii_entity_types, public.project_pii_configs from anon, authenticated;
grant select on public.pii_entity_types, public.project_pii_configs to authenticated;

grant execute on function public.get_project_pii_config(uuid) to authenticated;
grant execute on function public.update_project_pii_config(uuid, text[]) to authenticated;
