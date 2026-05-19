-- 019_list_review_items_paged.sql
-- Run after 014_list_review_items_rpc_jsonb.sql.
-- Then run 020_list_review_items_page_2args.sql (PostgREST often omits null JSON
-- keys so the first RPC call resolves to the two-argument overload).
-- Purpose:
--   Avoid statement_timeout when listing huge datasets by splitting reads into
--   bounded pages (same row shape/order as legacy list_review_items).
--   Legacy list_review_items is replaced with an exception stub so callers
--   accidentally hitting the heavy aggregate fail fast instead of timing out.

-- ── Deprecate legacy monolithic aggregate ────────────────────────────

drop function if exists public.list_review_items(uuid);

create or replace function public.list_review_items(p_dataset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'list_review_items is deprecated — use list_review_items_page(count + keyset paging)'
    using errcode = '0A000',
          hint = 'Call public.list_review_items_page(p_dataset_id, p_limit, p_after)';
end;
$$;

grant execute on function public.list_review_items(uuid) to authenticated;

-- ── Cheap counts / entity types per dataset ─────────────────────────

create or replace function public.count_review_items_by_dataset(p_dataset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with scoped as (
    select ri.entity_type, ri.status, ri.verdict
    from public.review_items ri
    join public.datasets d on d.id = ri.dataset_id
    where ri.dataset_id = p_dataset_id
      and private.is_project_member(d.project_id)
  ),
  ents as (
    select coalesce(array_agg(distinct entity_type order by entity_type), '{}'::text[]) as entity_types
    from scoped
  )
  select jsonb_build_object(
    'total',
    (select count(*) from scoped),
    'pending',
    (select count(*) from scoped where status = 'pending'),
    'completed',
    (select count(*) from scoped where status = 'completed'),
    'skipped',
    (select count(*) from scoped where status = 'skipped'),
    'correct',
    (select count(*) from scoped where verdict = 'CORRECT'),
    'wrong_label',
    (select count(*) from scoped where verdict = 'WRONG_LABEL'),
    'unrealistic_value',
    (select count(*) from scoped where verdict = 'UNREALISTIC_VALUE'),
    'entity_types',
    coalesce(to_jsonb((select entity_types from ents)), '[]'::jsonb)
  );
$$;

grant execute on function public.count_review_items_by_dataset(uuid) to authenticated;

-- ── Ordered page matching legacy ORDER BY + stable id tie-break ──────
-- Ordering: status DESC, entity ASC, sample_key ASC, audit ASC NULLS LAST,
-- id ASC. Keyseek uses the same comparator as this ORDER BY.

create or replace function public.list_review_items_page(
  p_dataset_id uuid,
  p_limit int,
  p_after jsonb default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with lim as (
    select least(greatest(coalesce(p_limit, 500), 1), 5000)::bigint as n
  ),
  base as (
    select
      ri.id,
      ri.dataset_id,
      ri.sample_row_id,
      ri.sample_key,
      ri.entity_type,
      ri.audit_record_id,
      ri.value,
      ri.start_offset,
      ri.end_offset,
      ri.verdict,
      ri.reason,
      ri.suggested_label,
      ri.replacement_value,
      ri.status,
      ri.decision,
      ri.reviewer_note,
      ri.decided_by,
      ri.decided_at,
      ri.version,
      ri.updated_at,
      ri.created_at
    from public.review_items ri
    join public.datasets d on d.id = ri.dataset_id
    where ri.dataset_id = p_dataset_id
      and private.is_project_member(d.project_id)
      and (
        p_after is null
        or (
          -- Rows strictly after cursor in canonical sort order
          ri.status::text < (p_after ->> 'status')
          or (
            ri.status::text = (p_after ->> 'status')
            and ri.entity_type > (p_after ->> 'entity_type')
          )
          or (
            ri.status::text = (p_after ->> 'status')
            and ri.entity_type = (p_after ->> 'entity_type')
            and ri.sample_key > (p_after ->> 'sample_key')
          )
          or (
            ri.status::text = (p_after ->> 'status')
            and ri.entity_type = (p_after ->> 'entity_type')
            and ri.sample_key = (p_after ->> 'sample_key')
            and (
              case
                -- Cursor audit_record_id encoded as JSON null -> NULLS LAST block
                when jsonb_typeof(p_after -> 'audit_record_id') = 'null' then (
                  ri.audit_record_id is null
                  and ri.id > (p_after ->> 'id')::uuid
                )
                else (
                  (
                    ri.audit_record_id is not null
                    and ri.audit_record_id
                      > ((p_after ->> 'audit_record_id')::integer)
                  )
                  or (ri.audit_record_id is null)
                  or (
                    ri.audit_record_id is not null
                    and ri.audit_record_id
                      = ((p_after ->> 'audit_record_id')::integer)
                    and ri.id > (p_after ->> 'id')::uuid
                  )
                )
              end
            )
          )
        )
      )
    order by
      ri.status desc,
      ri.entity_type asc,
      ri.sample_key asc,
      ri.audit_record_id asc nulls last,
      ri.id asc
    limit (select n from lim)
  ),
  jb as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id',                b.id,
            'dataset_id',        b.dataset_id,
            'sample_row_id',     b.sample_row_id,
            'sample_key',        b.sample_key,
            'entity_type',       b.entity_type,
            'audit_record_id',   b.audit_record_id,
            'value',             b.value,
            'start_offset',      b.start_offset,
            'end_offset',        b.end_offset,
            'verdict',           b.verdict,
            'reason',            b.reason,
            'suggested_label',   b.suggested_label,
            'replacement_value', b.replacement_value,
            'status',            b.status,
            'decision',          b.decision,
            'reviewer_note',     b.reviewer_note,
            'decided_by',        b.decided_by,
            'decided_at',        b.decided_at,
            'version',           b.version,
            'updated_at',        b.updated_at,
            'created_at',        b.created_at
          )
          order by
            b.status desc,
            b.entity_type asc,
            b.sample_key asc,
            b.audit_record_id asc nulls last,
            b.id asc
        ),
        '[]'::jsonb
      ) as items
    from base b
  ),
  cnt as (
    select coalesce(count(*), 0)::bigint as c from base
  ),
  last_row as (
    select b.*
    from base b
    order by
      b.status desc,
      b.entity_type asc,
      b.sample_key asc,
      b.audit_record_id asc nulls last,
      b.id asc
    offset (
      select greatest(cnt.c - 1, 0) from cnt
    )
    limit 1
  )
  select jsonb_build_object(
    'items', (select items from jb),
    'next_after',
      case
        when (select c from cnt) < (select n from lim)
          or (select c from cnt) = 0
        then null::jsonb
        else (
          select jsonb_build_object(
            'status', lr.status::text,
            'entity_type', lr.entity_type,
            'sample_key', lr.sample_key,
            'audit_record_id', to_jsonb(lr.audit_record_id),
            'id', lr.id::text
          )
          from last_row lr
        )
      end
  );
$$;

grant execute on function public.list_review_items_page(uuid, int, jsonb) to authenticated;
