-- Day 10 Session 1: operational visibility for continuous scraping.
--
-- One row per source_key (e.g. 'blackstone', 'psers', 'calstrs-board',
-- 'cafr-calpers'). Cron endpoints upsert here on every run so /admin/
-- ingestion and the scraper-health-check cron can tell when a source
-- has gone silent without anyone noticing.
--
-- Additive; service-role-only (no authenticated policies — writes happen
-- from cron routes that use SUPABASE_SECRET_KEY, reads happen from the
-- admin page via the admin client or a thin server action).

create table if not exists public.scrape_fingerprints (
  id               uuid primary key default gen_random_uuid(),
  source_key       text not null unique,
  last_hash        text,
  last_checked_at  timestamptz not null default now(),
  last_changed_at  timestamptz,
  expected_cadence_hours  integer not null default 24,
  last_run_summary text,
  last_run_ok      boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists scrape_fingerprints_checked_idx
  on public.scrape_fingerprints (last_checked_at desc);

alter table public.scrape_fingerprints enable row level security;
-- No authenticated policies → service_role-only access.

comment on table public.scrape_fingerprints is
  'Per-source fingerprint + last-checked timestamp. Written by the scrape-* cron endpoints; read by the admin /admin/ingestion page and the scraper-health-check cron.';
comment on column public.scrape_fingerprints.source_key is
  'Stable lowercase identifier. Examples: blackstone, brookfield, psers, nystrs, calstrs, calpers, nyscrf, michigan, wsib, cafr-all.';
comment on column public.scrape_fingerprints.expected_cadence_hours is
  'Expected max interval between checks; the health-check cron alerts if last_checked_at is older than 2 x this value.';
