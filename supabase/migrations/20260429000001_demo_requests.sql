-- Day 7: demo_requests — landing-page email capture.
-- Additive. service_role inserts from the Next.js server action; RLS locks
-- out anon/authenticated reads entirely (no policies).

create table if not exists public.demo_requests (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  captured_at timestamptz not null default now(),
  source      text not null default 'landing_page',
  ip_hash     text
);

create index if not exists demo_requests_captured_idx
  on public.demo_requests (captured_at desc);

alter table public.demo_requests enable row level security;
-- No policies → only service_role can read/write (bypasses RLS).

comment on table public.demo_requests is
  'Landing-page demo capture. service_role-only; no end-user access.';
