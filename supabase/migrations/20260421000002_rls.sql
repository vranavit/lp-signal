-- Row-level security for LP Signal
-- The publishable (anon) key is client-visible, so every table that can be read
-- with that key needs explicit policies. The secret (service_role) key bypasses
-- RLS and is only used server-side in cron endpoints and admin scripts.

alter table public.plans           enable row level security;
alter table public.documents       enable row level security;
alter table public.signals         enable row level security;
alter table public.firms           enable row level security;
alter table public.user_profiles   enable row level security;
alter table public.saved_searches  enable row level security;
alter table public.allowed_emails  enable row level security;

-- ── plans: authenticated users can read ─────────────────────────────────────
create policy "plans_read_authenticated"
  on public.plans for select
  to authenticated
  using (true);

-- ── documents: authenticated users can read ─────────────────────────────────
create policy "documents_read_authenticated"
  on public.documents for select
  to authenticated
  using (true);

-- ── signals: authenticated users can read ───────────────────────────────────
create policy "signals_read_authenticated"
  on public.signals for select
  to authenticated
  using (true);

-- ── user_profiles: user can read / update their own row ─────────────────────
create policy "user_profiles_read_self"
  on public.user_profiles for select
  to authenticated
  using (id = auth.uid());

create policy "user_profiles_update_self"
  on public.user_profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ── saved_searches: user owns their rows ────────────────────────────────────
create policy "saved_searches_owner_all"
  on public.saved_searches for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── firms, allowed_emails: no authenticated access (service_role only) ──────
-- By enabling RLS without any policies, all anon/authenticated access is denied.
-- The secret key used by server-side code bypasses RLS entirely.
