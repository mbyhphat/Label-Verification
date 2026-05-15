-- 001_schema.sql
-- Run first in Supabase SQL Editor.
-- Purpose:
--   Create the base relational model for the verifier.
--   This file defines projects, project members, shared source datasets,
--   lockable samples, class-specific review items, audit events, and indexes.
--   Run this before RLS, RPC functions, Realtime, or seed data.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.labeling_projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9_-]*$'),
  name text not null,
  description text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.project_members (
  project_id uuid not null references public.labeling_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'reviewer', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.datasets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.labeling_projects(id) on delete cascade,
  source_key text not null,
  entity_type text not null default 'MULTI_ENTITY',
  language text not null,
  folder text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.review_samples (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  sample_index integer not null,
  sample_key text not null,
  language text not null,
  original_source_text text not null,
  current_source_text text not null,
  original_privacy_mask jsonb not null default '[]'::jsonb,
  current_privacy_mask jsonb not null default '[]'::jsonb,
  raw_output jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  locked_by uuid references auth.users(id),
  locked_until timestamptz,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (dataset_id, sample_index),
  unique (dataset_id, sample_key)
);

create table if not exists public.review_items (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  sample_row_id uuid not null references public.review_samples(id) on delete cascade,
  sample_key text not null,
  entity_type text not null,
  audit_record_id integer,
  value text not null,
  start_offset integer,
  end_offset integer,
  verdict text not null check (verdict in ('CORRECT', 'WRONG_LABEL', 'UNREALISTIC_VALUE')),
  reason text,
  suggested_label text,
  replacement_value text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'skipped')),
  decision text check (decision in ('accept', 'deny', 'deny_keep', 'deny_remove')),
  reviewer_note text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  raw_audit jsonb not null default '{}'::jsonb,
  raw_export_span jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

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

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  project_id uuid references public.labeling_projects(id) on delete cascade,
  dataset_id uuid references public.datasets(id) on delete cascade,
  sample_row_id uuid references public.review_samples(id) on delete set null,
  review_item_id uuid references public.review_items(id) on delete set null,
  actor_id uuid references auth.users(id),
  action text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create index if not exists datasets_project_id_idx
on public.datasets(project_id);

create unique index if not exists datasets_source_unique
on public.datasets(project_id, language, coalesce(folder, ''), source_key);

create index if not exists review_samples_dataset_idx
on public.review_samples(dataset_id, sample_index);

create index if not exists review_samples_lock_idx
on public.review_samples(locked_by, locked_until);

create index if not exists review_items_dataset_status_idx
on public.review_items(dataset_id, status);

create index if not exists review_items_dataset_entity_status_idx
on public.review_items(dataset_id, entity_type, status);

create index if not exists review_items_sample_idx
on public.review_items(sample_row_id);

create index if not exists audit_events_dataset_idx
on public.audit_events(dataset_id, created_at desc);
