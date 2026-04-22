-- Day 5: allocation_policy_changes — derived from sequential pension_allocations
-- snapshots. When a pension's target_pct for an asset class moves between
-- two consecutive CAFR/policy filings, we flag it as a policy change signal.
--
-- This is a "stock delta" feed — complements the per-event signals table.
-- Detection lives in scripts/detect-policy-changes.ts; this table is the
-- store. Additive; no existing data touched.

create table if not exists public.allocation_policy_changes (
  id                    uuid primary key default gen_random_uuid(),
  plan_id               uuid not null references public.plans(id) on delete cascade,
  asset_class           text not null,
  previous_target_pct   numeric(5, 2) not null,
  new_target_pct        numeric(5, 2) not null,
  -- Generated columns: change_pp + change_direction derive from the prev/new
  -- target pair. Stored generated so the dashboard can sort/filter without
  -- recomputing. PostgreSQL 12+ supports STORED generated columns.
  change_pp             numeric(5, 2) generated always as
                          (new_target_pct - previous_target_pct) stored,
  change_direction      text generated always as (
                          case
                            when new_target_pct > previous_target_pct then 'increase'
                            when new_target_pct < previous_target_pct then 'decrease'
                            else 'no_change'
                          end
                        ) stored,
  as_of_date_previous   date not null,
  as_of_date_new        date not null,
  implied_usd_delta     bigint,
  detected_at           timestamptz not null default now()
);

-- One change row per (plan, asset class, prev→new) pair. If detection re-runs,
-- the unique index makes the upsert a no-op for already-known changes.
create unique index if not exists allocation_policy_changes_unique_idx
  on public.allocation_policy_changes
  (plan_id, asset_class, as_of_date_previous, as_of_date_new);

create index if not exists allocation_policy_changes_plan_idx
  on public.allocation_policy_changes (plan_id, detected_at desc);

alter table public.allocation_policy_changes enable row level security;

create policy "allocation_policy_changes_read_authenticated"
  on public.allocation_policy_changes for select
  to authenticated
  using (true);

comment on table public.allocation_policy_changes is
  'Derived stock-delta signals: target allocation changes between consecutive CAFR snapshots for the same plan + asset class.';
