-- Day 4: pension_allocations — portfolio allocation "stock" data extracted
-- from Comprehensive Annual Financial Reports (CAFRs/ACFRs). Complements the
-- "flow" data in public.signals (new commitments, pacing changes).
--
-- One row per (plan, as_of_date, asset_class). A full CAFR produces 6-10 rows
-- — one per asset class in the policy table — plus a total_plan_aum figure
-- replicated onto each row for convenient gap-dollar math.
--
-- Additive migration. No existing data touched.

create table if not exists public.pension_allocations (
  id                   uuid primary key default gen_random_uuid(),
  plan_id              uuid not null references public.plans(id) on delete cascade,
  as_of_date           date not null,
  asset_class          text not null check (asset_class in (
    'PE', 'Infra', 'Credit', 'RE', 'VC',
    'Public Equity', 'Fixed Income', 'Cash', 'Other'
  )),
  target_pct           numeric(5, 2) not null,
  target_min_pct       numeric(5, 2),
  target_max_pct       numeric(5, 2),
  actual_pct           numeric(5, 2),
  actual_usd           bigint,
  total_plan_aum_usd   bigint,
  source_document_id   uuid references public.documents(id) on delete set null,
  source_page          int,
  source_quote         text,
  confidence           numeric(3, 2) not null default 0.0
                         check (confidence between 0 and 1),
  preliminary          boolean not null default false,
  prompt_version       text,
  created_at           timestamptz not null default now()
);

create index if not exists pension_allocations_plan_date_asset_idx
  on public.pension_allocations (plan_id, as_of_date desc, asset_class);

-- RLS — match signals table: authenticated users can read.
alter table public.pension_allocations enable row level security;

create policy "pension_allocations_read_authenticated"
  on public.pension_allocations for select
  to authenticated
  using (true);

comment on table public.pension_allocations is
  'Portfolio allocation stock data extracted from CAFRs. One row per (plan, fiscal year end, asset class).';
comment on column public.pension_allocations.preliminary is
  'Same confidence-tiered routing as signals: true when confidence is in the 0.70–0.85 band.';
