-- Geo-Grid v3 (idempotent: safe whether or not v1 was already run) — paste into the ledger project's SQL Editor.
-- Adds Chrome pack + raw-harvest columns; includes the full v1 schema as create-if-not-exists.

create extension if not exists pgcrypto;

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  token uuid not null default gen_random_uuid(),
  client text default '',
  keyword text not null,
  gbp_name text not null,
  center_lat float8 not null,
  center_lng float8 not null,
  grid_size int not null default 7,
  spacing_miles float8 not null default 1,
  status text not null default 'running',
  points_total int not null default 0,
  points_done int not null default 0,
  credits_debited int not null default 0,
  ledger_key text default 'owner',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.scan_points (
  id bigint generated always as identity primary key,
  scan_id uuid not null references public.scans(id) on delete cascade,
  label text not null,
  lat float8 not null,
  lng float8 not null,
  phone_id text,
  state text not null default 'pending',
  attempts int not null default 0,
  gps_set_at timestamptz,
  task_issued_at timestamptz,
  done_at timestamptz,
  position int,
  titles jsonb,
  surface text,
  error text,
  unique (scan_id, label)
);

alter table public.scan_points add column if not exists pack_titles jsonb;
alter table public.scan_points add column if not exists pack_position int;

create index if not exists scan_points_scan_state on public.scan_points (scan_id, state);
create index if not exists scans_status on public.scans (status);
create unique index if not exists scans_token on public.scans (token);

alter table public.scans enable row level security;
alter table public.scan_points enable row level security;
alter table public.scan_points add column if not exists raw_serp jsonb;
alter table public.scan_points add column if not exists raw_finder jsonb;
alter table public.scan_points add column if not exists pack_has_ad boolean;
alter table public.scan_points add column if not exists video_url text;
alter table public.scan_points add column if not exists video_path text;
alter table public.scan_points add column if not exists video_error text;

-- Supabase Storage bucket for grid point screen recordings (run once in SQL Editor)
insert into storage.buckets (id, name, public)
values ('geogrid-videos', 'geogrid-videos', true)
on conflict (id) do update set public = true;

create policy if not exists "Public read geogrid videos"
on storage.objects for select
using (bucket_id = 'geogrid-videos');

create policy if not exists "Service role upload geogrid videos"
on storage.objects for insert
with check (bucket_id = 'geogrid-videos');
