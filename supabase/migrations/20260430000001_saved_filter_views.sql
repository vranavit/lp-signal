-- E Phase 1.2: saved_filter_views — per-user saved filter combinations.
-- Additive. Authenticated users CRUD their own rows only; no cross-user
-- reads, no service_role-only path — this is end-user facing.

create table if not exists public.saved_filter_views (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 80),
  page        text not null check (page in ('outreach', 'signals')),
  filter_json jsonb not null,
  created_at  timestamptz not null default now()
);

-- One (user, name, page) can't collide — keeps the UI's named list tidy.
create unique index if not exists saved_filter_views_unique_name_idx
  on public.saved_filter_views (user_id, page, lower(name));

create index if not exists saved_filter_views_user_page_idx
  on public.saved_filter_views (user_id, page, created_at desc);

alter table public.saved_filter_views enable row level security;

create policy "saved_filter_views_select_own"
  on public.saved_filter_views for select
  to authenticated
  using (user_id = auth.uid());

create policy "saved_filter_views_insert_own"
  on public.saved_filter_views for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "saved_filter_views_delete_own"
  on public.saved_filter_views for delete
  to authenticated
  using (user_id = auth.uid());

comment on table public.saved_filter_views is
  'Per-user named filter combinations for /signals and /outreach. UI: components/filters/saved-views-menu.tsx.';
