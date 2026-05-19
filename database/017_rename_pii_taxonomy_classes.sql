-- 017_rename_pii_taxonomy_classes.sql
-- Run after 016_import_dataset_samples_batch_rpc.sql.
--
-- Purpose:
--   Rename the existing PII class names to the updated taxonomy from
--   PII_Taxonomy_Updated.pdf.
--
-- Notes:
--   - This updates relational columns, project config arrays, catalog rows, and
--     JSONB payloads including privacy_mask arrays, raw_output, dataset metadata,
--     raw audit/export spans, and audit event snapshots.
--   - It only renames exact class-name strings, for example "PHONE_NUMBER" to
--     "PHONE". It does not rewrite arbitrary substrings inside longer text.
--   - New taxonomy classes that had no old equivalent are intentionally skipped.
--     This migration only renames existing classes and preserves custom classes.
--   - Run during a maintenance window if reviewers may have samples open.

begin;

set local statement_timeout = '10min';

create temp table pii_taxonomy_rename_map (
  old_name text primary key,
  new_name text not null unique
) on commit drop;

insert into pii_taxonomy_rename_map (old_name, new_name)
values
  ('PERSONAL_NAME', 'PERSON'),
  ('SEX', 'GENDER'),
  ('DOB', 'BIRTH_DATE'),
  ('PHONE_NUMBER', 'PHONE'),
  ('STREET_ADDRESS', 'ADDRESS'),
  ('ZIPCODE', 'ZIP_CODE'),
  ('GPS_COORDINATE', 'COORDINATE'),
  ('IP_ADDRESS', 'IP'),
  ('ACCOUNT_NUMBER', 'BANK_ACCOUNT'),
  ('AMOUNT', 'MONEY'),
  ('CREDIT_CARD_ISSUER', 'CARD_ISSUER'),
  ('CREDIT_CARD_NUMBER', 'CARD_NUMBER'),
  ('CREDIT_CARD_CVV', 'CVV'),
  ('BIC_SWIFT', 'SWIFT'),
  ('CRYPTO_ADDRESS', 'WALLET'),
  ('OCCUPATION', 'JOB_TITLE'),
  ('SSN_CCCD', 'NATIONAL_ID'),
  ('PASSPORT_NUM', 'PASSPORT'),
  ('DRIVER_LICENSE', 'LICENSE'),
  ('TAX_ID', 'TIN'),
  ('MARITAL_STATUS', 'MARITAL'),
  ('TRADE_UNION_INFO', 'TRADE_UNION'),
  ('HEALTH_INSURANCE', 'INSURANCE_ID'),
  ('HEALTH_STATUS', 'MEDICAL_INFO');

create temp table pii_taxonomy_catalog (
  sort_order integer primary key,
  entity_type text not null unique
) on commit drop;

insert into pii_taxonomy_catalog (sort_order, entity_type)
values
  (1, 'PREFIX'),
  (2, 'PERSON'),
  (3, 'GENDER'),
  (4, 'AGE'),
  (5, 'BIRTH_DATE'),
  (6, 'PHONE'),
  (7, 'EMAIL'),
  (8, 'LOCATION'),
  (9, 'ADDRESS'),
  (10, 'ZIP_CODE'),
  (11, 'COORDINATE'),
  (12, 'USERNAME'),
  (15, 'PASSWORD'),
  (16, 'PIN'),
  (18, 'URL'),
  (19, 'IP'),
  (20, 'BANK_ACCOUNT'),
  (21, 'MONEY'),
  (22, 'CARD_ISSUER'),
  (23, 'CARD_NUMBER'),
  (24, 'CVV'),
  (25, 'IBAN'),
  (26, 'SWIFT'),
  (27, 'WALLET'),
  (28, 'JOB_TITLE'),
  (31, 'NATIONAL_ID'),
  (32, 'PASSPORT'),
  (33, 'LICENSE'),
  (35, 'TIN'),
  (36, 'DATE'),
  (37, 'TIME'),
  (38, 'MARITAL'),
  (39, 'RELIGION'),
  (40, 'ETHNICITY'),
  (41, 'TRADE_UNION'),
  (42, 'NATIONALITY'),
  (43, 'INSURANCE_ID'),
  (44, 'MEDICAL_INFO');

create or replace function pg_temp.rename_pii_taxonomy_jsonb(p_value jsonb)
returns jsonb
language sql
stable
as $$
  select case jsonb_typeof(p_value)
    when 'object' then (
      select coalesce(
        jsonb_object_agg(
          coalesce(rename_map.new_name, entry.key),
          pg_temp.rename_pii_taxonomy_jsonb(entry.value)
          order by case when rename_map.old_name is null then 1 else 0 end
        ),
        '{}'::jsonb
      )
      from jsonb_each(p_value) as entry(key, value)
      left join pg_temp.pii_taxonomy_rename_map rename_map
        on rename_map.old_name = entry.key
    )
    when 'array' then (
      select coalesce(
        jsonb_agg(
          pg_temp.rename_pii_taxonomy_jsonb(element.value)
          order by element.ordinality
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(p_value) with ordinality as element(value, ordinality)
    )
    when 'string' then coalesce(
      (
        select to_jsonb(rename_map.new_name)
        from pg_temp.pii_taxonomy_rename_map rename_map
        where rename_map.old_name = p_value #>> '{}'
      ),
      p_value
    )
    else p_value
  end
$$;

do $$
begin
  if exists (
    select 1
    from public.review_items old_item
    join pg_temp.pii_taxonomy_rename_map rename_map
      on rename_map.old_name = old_item.entity_type
    join public.review_items existing_item
      on existing_item.dataset_id = old_item.dataset_id
     and existing_item.entity_type = rename_map.new_name
     and existing_item.sample_key = old_item.sample_key
     and existing_item.audit_record_id is not distinct from old_item.audit_record_id
     and existing_item.value = old_item.value
     and coalesce(existing_item.start_offset, -1) = coalesce(old_item.start_offset, -1)
     and coalesce(existing_item.end_offset, -1) = coalesce(old_item.end_offset, -1)
     and existing_item.id <> old_item.id
  ) then
    raise exception 'taxonomy_rename_conflict: review_items already contain both old and new class names for the same span';
  end if;
end
$$;

with expanded as (
  select
    config.project_id,
    coalesce(rename_map.new_name, item.entity_type) as entity_type,
    item.ordinality
  from public.project_pii_configs config
  cross join unnest(config.required_entity_types) with ordinality as item(entity_type, ordinality)
  left join pg_temp.pii_taxonomy_rename_map rename_map
    on rename_map.old_name = item.entity_type
),
deduped as (
  select
    expanded.project_id,
    expanded.entity_type,
    min(expanded.ordinality) as first_ordinality
  from expanded
  group by expanded.project_id, expanded.entity_type
),
rewritten as (
  select
    deduped.project_id,
    array_agg(deduped.entity_type order by deduped.first_ordinality)::text[] as required_entity_types
  from deduped
  group by deduped.project_id
)
update public.project_pii_configs config
set required_entity_types = rewritten.required_entity_types,
    updated_at = now()
from rewritten
where config.project_id = rewritten.project_id
  and config.required_entity_types is distinct from rewritten.required_entity_types;

with rewritten as (
  select
    dataset.id,
    coalesce(rename_map.new_name, dataset.entity_type) as entity_type,
    case
      when exists (
        select 1
        from pg_temp.pii_taxonomy_rename_map probe
        where dataset.metadata::text like '%' || probe.old_name || '%'
      )
        then pg_temp.rename_pii_taxonomy_jsonb(dataset.metadata)
      else dataset.metadata
    end as metadata
  from public.datasets dataset
  left join pg_temp.pii_taxonomy_rename_map rename_map
    on rename_map.old_name = dataset.entity_type
  where rename_map.old_name is not null
     or exists (
       select 1
       from pg_temp.pii_taxonomy_rename_map probe
       where dataset.metadata::text like '%' || probe.old_name || '%'
     )
)
update public.datasets dataset
set entity_type = rewritten.entity_type,
    metadata = rewritten.metadata
from rewritten
where dataset.id = rewritten.id
  and (
    dataset.entity_type is distinct from rewritten.entity_type
    or dataset.metadata is distinct from rewritten.metadata
  );

with rewritten as (
  select
    sample.id,
    pg_temp.rename_pii_taxonomy_jsonb(sample.original_privacy_mask) as original_privacy_mask,
    pg_temp.rename_pii_taxonomy_jsonb(sample.current_privacy_mask) as current_privacy_mask,
    pg_temp.rename_pii_taxonomy_jsonb(sample.raw_output) as raw_output
  from public.review_samples sample
  where exists (
    select 1
    from pg_temp.pii_taxonomy_rename_map probe
    where sample.original_privacy_mask::text like '%' || probe.old_name || '%'
       or sample.current_privacy_mask::text like '%' || probe.old_name || '%'
       or sample.raw_output::text like '%' || probe.old_name || '%'
  )
)
update public.review_samples sample
set original_privacy_mask = rewritten.original_privacy_mask,
    current_privacy_mask = rewritten.current_privacy_mask,
    raw_output = rewritten.raw_output,
    version = sample.version + 1,
    updated_at = now()
from rewritten
where sample.id = rewritten.id
  and (
    sample.original_privacy_mask is distinct from rewritten.original_privacy_mask
    or sample.current_privacy_mask is distinct from rewritten.current_privacy_mask
    or sample.raw_output is distinct from rewritten.raw_output
  );

with rewritten as (
  select
    item.id,
    coalesce(entity_rename.new_name, item.entity_type) as entity_type,
    coalesce(label_rename.new_name, item.suggested_label) as suggested_label,
    case
      when exists (
        select 1
        from pg_temp.pii_taxonomy_rename_map probe
        where item.raw_audit::text like '%' || probe.old_name || '%'
      )
        then pg_temp.rename_pii_taxonomy_jsonb(item.raw_audit)
      else item.raw_audit
    end as raw_audit,
    case
      when exists (
        select 1
        from pg_temp.pii_taxonomy_rename_map probe
        where item.raw_export_span::text like '%' || probe.old_name || '%'
      )
        then pg_temp.rename_pii_taxonomy_jsonb(item.raw_export_span)
      else item.raw_export_span
    end as raw_export_span
  from public.review_items item
  left join pg_temp.pii_taxonomy_rename_map entity_rename
    on entity_rename.old_name = item.entity_type
  left join pg_temp.pii_taxonomy_rename_map label_rename
    on label_rename.old_name = item.suggested_label
  where entity_rename.old_name is not null
     or label_rename.old_name is not null
     or exists (
       select 1
       from pg_temp.pii_taxonomy_rename_map probe
       where item.raw_audit::text like '%' || probe.old_name || '%'
          or item.raw_export_span::text like '%' || probe.old_name || '%'
     )
)
update public.review_items item
set entity_type = rewritten.entity_type,
    suggested_label = rewritten.suggested_label,
    raw_audit = rewritten.raw_audit,
    raw_export_span = rewritten.raw_export_span,
    version = item.version + 1,
    updated_at = now()
from rewritten
where item.id = rewritten.id
  and (
    item.entity_type is distinct from rewritten.entity_type
    or item.suggested_label is distinct from rewritten.suggested_label
    or item.raw_audit is distinct from rewritten.raw_audit
    or item.raw_export_span is distinct from rewritten.raw_export_span
  );

with rewritten as (
  select
    event.id,
    case
      when event.before_state is not null and exists (
        select 1
        from pg_temp.pii_taxonomy_rename_map probe
        where event.before_state::text like '%' || probe.old_name || '%'
      )
        then pg_temp.rename_pii_taxonomy_jsonb(event.before_state)
      else event.before_state
    end as before_state,
    case
      when event.after_state is not null and exists (
        select 1
        from pg_temp.pii_taxonomy_rename_map probe
        where event.after_state::text like '%' || probe.old_name || '%'
      )
        then pg_temp.rename_pii_taxonomy_jsonb(event.after_state)
      else event.after_state
    end as after_state
  from public.audit_events event
  where exists (
    select 1
    from pg_temp.pii_taxonomy_rename_map probe
    where event.before_state::text like '%' || probe.old_name || '%'
       or event.after_state::text like '%' || probe.old_name || '%'
  )
)
update public.audit_events event
set before_state = rewritten.before_state,
    after_state = rewritten.after_state
from rewritten
where event.id = rewritten.id
  and (
    event.before_state is distinct from rewritten.before_state
    or event.after_state is distinct from rewritten.after_state
  );

with sort_offset as (
  select coalesce(max(sort_order), 0) + 100000 as value
  from public.pii_entity_types
)
update public.pii_entity_types catalog
set sort_order = catalog.sort_order + sort_offset.value
from sort_offset;

delete from public.pii_entity_types catalog
using pg_temp.pii_taxonomy_rename_map rename_map
where catalog.entity_type = rename_map.old_name;

insert into public.pii_entity_types (sort_order, entity_type)
select sort_order, entity_type
from pg_temp.pii_taxonomy_catalog
on conflict (entity_type) do update
set sort_order = excluded.sort_order;

with extras as (
  select
    catalog.entity_type,
    100000 + row_number() over (order by catalog.entity_type)::integer as sort_order
  from public.pii_entity_types catalog
  where not exists (
    select 1
    from pg_temp.pii_taxonomy_catalog updated
    where updated.entity_type = catalog.entity_type
  )
)
update public.pii_entity_types catalog
set sort_order = extras.sort_order
from extras
where catalog.entity_type = extras.entity_type;

analyze public.datasets;
analyze public.review_samples;
analyze public.review_items;
analyze public.audit_events;
analyze public.pii_entity_types;
analyze public.project_pii_configs;

commit;

-- Quick checks after running:
--
-- with old_names(old_name) as (
--   values
--     ('PERSONAL_NAME'), ('SEX'), ('DOB'), ('PHONE_NUMBER'), ('STREET_ADDRESS'),
--     ('ZIPCODE'), ('GPS_COORDINATE'), ('IP_ADDRESS'), ('ACCOUNT_NUMBER'),
--     ('AMOUNT'), ('CREDIT_CARD_ISSUER'), ('CREDIT_CARD_NUMBER'),
--     ('CREDIT_CARD_CVV'), ('BIC_SWIFT'), ('CRYPTO_ADDRESS'), ('OCCUPATION'),
--     ('SSN_CCCD'), ('PASSPORT_NUM'), ('DRIVER_LICENSE'), ('TAX_ID'),
--     ('MARITAL_STATUS'), ('TRADE_UNION_INFO'), ('HEALTH_INSURANCE'),
--     ('HEALTH_STATUS')
-- )
-- select old_name
-- from old_names
-- where exists (select 1 from public.review_items where entity_type = old_name)
--    or exists (select 1 from public.review_items where suggested_label = old_name)
--    or exists (select 1 from public.pii_entity_types where entity_type = old_name)
-- order by old_name;
--
-- select ri.entity_type, count(*)
-- from public.review_items ri
-- group by ri.entity_type
-- order by ri.entity_type;
--
-- select entity_type, sort_order
-- from public.pii_entity_types
-- order by sort_order, entity_type;
