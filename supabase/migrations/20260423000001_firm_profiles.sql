-- Firm profiles — per-user ICP definition used to score signal relevance.
-- Day 3 introduces scoring as a derived read-only column on the signals
-- query (not persisted per-signal), so this table is the sole source of truth
-- for the user's ICP.

create table if not exists public.firm_profiles (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  firm_name            text,
  asset_class_focus    text[] not null default '{}',
  fund_stage           text check (fund_stage in ('emerging', 'established', 'flagship')),
  check_size_min_usd   bigint,
  check_size_max_usd   bigint,
  geographic_focus     text[] not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists firm_profiles_user_idx
  on public.firm_profiles (user_id);

-- Automatic updated_at on UPDATE.
create or replace function public.firm_profiles_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists firm_profiles_touch on public.firm_profiles;
create trigger firm_profiles_touch
  before update on public.firm_profiles
  for each row execute function public.firm_profiles_touch_updated_at();

-- RLS: user owns their row.
alter table public.firm_profiles enable row level security;

create policy "firm_profiles_owner_all"
  on public.firm_profiles for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Default firm profile for Vitek (owner). Upserts per user_profiles email
-- match; if the user isn't yet provisioned, this is a no-op.
do $$
declare
  v_uid uuid;
begin
  select id into v_uid
    from auth.users
   where email = 'vitek.vrana@bloorcapital.com'
   limit 1;
  if v_uid is not null then
    insert into public.firm_profiles (
      user_id, firm_name, asset_class_focus, fund_stage,
      check_size_min_usd, check_size_max_usd, geographic_focus
    ) values (
      v_uid,
      'Bloor Capital',
      array['PE'],
      'established',
      1000000000,  -- $1B
      5000000000,  -- $5B
      array['North America', 'Europe']
    )
    on conflict (user_id) do update set
      firm_name          = excluded.firm_name,
      asset_class_focus  = excluded.asset_class_focus,
      fund_stage         = excluded.fund_stage,
      check_size_min_usd = excluded.check_size_min_usd,
      check_size_max_usd = excluded.check_size_max_usd,
      geographic_focus   = excluded.geographic_focus;
  end if;
end;
$$;

comment on table public.firm_profiles is
  'Per-user ICP definition. relevance_score is computed from this at query time (see lib/relevance/score.ts).';
