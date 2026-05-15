-- 006_multi_entity_datasets.sql
-- Run this only if you already applied the older schema where each dataset
-- represented exactly one entity_type/class.
-- Purpose:
--   Migrate to a shared-source dataset model:
--   - one datasets row per output/source file,
--   - one review_samples set per source dataset,
--   - entity_type stored per review_items row.

alter table public.datasets
add column if not exists source_key text;

update public.datasets
set source_key = coalesce(
  nullif(metadata #>> '{import,sample_key_prefix}', ''),
  language || '/' || coalesce(folder, 'dataset')
)
where source_key is null;

alter table public.datasets
alter column source_key set not null;

alter table public.datasets
alter column entity_type set default 'MULTI_ENTITY';

alter table public.datasets
drop constraint if exists datasets_project_id_entity_type_language_folder_key;

create unique index if not exists datasets_source_unique
on public.datasets(project_id, language, coalesce(folder, ''), source_key);

alter table public.review_items
add column if not exists entity_type text;

update public.review_items ri
set entity_type = d.entity_type
from public.datasets d
where ri.dataset_id = d.id
  and ri.entity_type is null;

alter table public.review_items
alter column entity_type set not null;

drop index if exists review_items_unique_span;

create unique index if not exists review_items_unique_span
on public.review_items (
  dataset_id,
  entity_type,
  sample_key,
  audit_record_id,
  value,
  coalesce(start_offset, -1),
  coalesce(end_offset, -1)
);

create index if not exists review_items_dataset_entity_status_idx
on public.review_items(dataset_id, entity_type, status);
