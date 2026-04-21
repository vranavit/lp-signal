-- LP Signal initial schema
-- Tables: plans, documents, signals, firms, user_profiles, saved_searches, allowed_emails
-- All tables use uuid PKs with gen_random_uuid() defaults.
-- RLS is configured in a separate migration.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- plans: pension plans we monitor
-- ─────────────────────────────────────────────────────────────────────────────
create table public.plans (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  country         text not null check (country in ('US', 'CA')),
  aum_usd         bigint,
  tier            int check (tier in (1, 2, 3)),
  scrape_method   text check (scrape_method in ('board_minutes', 'press_release', 'annual_report', 'manual')),
  scrape_url      text,
  scrape_config   jsonb not null default '{}'::jsonb,
  last_scraped_at timestamptz,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create unique index plans_name_country_idx on public.plans (name, country);
create index plans_tier_idx on public.plans (tier) where active;

-- ─────────────────────────────────────────────────────────────────────────────
-- documents: source docs we've ingested
-- ─────────────────────────────────────────────────────────────────────────────
create table public.documents (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references public.plans(id) on delete cascade,
  document_type     text check (document_type in ('board_minutes', 'press_release', 'annual_report', 'agenda', 'other')),
  source_url        text not null,
  content_hash      text not null,
  storage_path      text,
  meeting_date      date,
  published_at      timestamptz,
  processed_at      timestamptz,
  processing_status text not null default 'pending' check (processing_status in ('pending', 'processing', 'complete', 'error')),
  error_message     text,
  created_at        timestamptz not null default now(),
  unique (plan_id, content_hash)
);

create index documents_plan_idx on public.documents (plan_id, published_at desc);
create index documents_status_idx on public.documents (processing_status);

-- ─────────────────────────────────────────────────────────────────────────────
-- signals: extracted LP signals
-- ─────────────────────────────────────────────────────────────────────────────
create table public.signals (
  id                    uuid primary key default gen_random_uuid(),
  document_id           uuid references public.documents(id) on delete set null,
  plan_id               uuid not null references public.plans(id) on delete cascade,
  signal_type           int not null check (signal_type in (1, 2, 3)),
  confidence            numeric(3, 2) not null check (confidence between 0 and 1),
  priority_score        int not null check (priority_score between 0 and 100),
  asset_class           text check (asset_class in ('PE', 'Infra', 'Credit', 'RE', 'VC', 'Other')),
  summary               text not null,
  fields                jsonb not null default '{}'::jsonb,
  source_page           int,
  source_quote          text,
  commitment_amount_usd bigint,
  seed_data             boolean not null default false,
  created_at            timestamptz not null default now()
);

create index signals_created_idx       on public.signals (created_at desc);
create index signals_priority_idx      on public.signals (priority_score desc, created_at desc);
create index signals_plan_idx          on public.signals (plan_id);
create index signals_asset_class_idx   on public.signals (asset_class);
create index signals_type_idx          on public.signals (signal_type);
create index signals_seed_idx          on public.signals (seed_data);

-- ─────────────────────────────────────────────────────────────────────────────
-- firms: customer firms
-- ─────────────────────────────────────────────────────────────────────────────
create table public.firms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  plan_tier  text check (plan_tier in ('starter', 'pro', 'enterprise')),
  seats      int not null default 5,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- user_profiles: extends auth.users
-- ─────────────────────────────────────────────────────────────────────────────
create table public.user_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  firm_id    uuid references public.firms(id) on delete set null,
  role       text not null default 'user' check (role in ('admin', 'user')),
  email      text,
  full_name  text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- saved_searches
-- ─────────────────────────────────────────────────────────────────────────────
create table public.saved_searches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  filters         jsonb not null default '{}'::jsonb,
  email_frequency text not null default 'off' check (email_frequency in ('off', 'instant', 'daily', 'weekly')),
  created_at      timestamptz not null default now()
);

create index saved_searches_user_idx on public.saved_searches (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- allowed_emails: sign-in allowlist (swap entries here without redeploying)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.allowed_emails (
  email      text primary key,
  note       text,
  added_at   timestamptz not null default now()
);

comment on table public.allowed_emails is
  'Sign-in allowlist enforced by a trigger on auth.users. Insert a row to grant a new user access; delete to revoke future sign-ins.';
