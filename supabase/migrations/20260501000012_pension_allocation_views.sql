-- 2026-04-26: pension_allocations display views (latest + rollup).
--
-- Background: docs/audits/duplicate-allocations-audit-2026-04-25.md
-- documents 32 (plan, asset_class) groups containing 92 of 190 rows
-- that the UI rendered as "duplicates". The data is correct -- the
-- duplicates are either (a) legitimate sub_class sub-sleeves of a
-- single asset_class with their own policy targets, or (b) older
-- fiscal-year snapshots of the same asset class. The fix is purely a
-- UI / query-layer concern, no rows mutated.
--
-- This migration adds two views the UI reads instead of the raw table:
--
--   pension_allocations_latest  -- current-snapshot view. Returns every
--                                  sub-sleeve row from the most recent
--                                  ingestion of each (plan, asset_class).
--                                  Older fiscal-year snapshots stay in
--                                  the underlying table for trend
--                                  analysis later.
--
--   pension_allocations_rollup  -- summary-card view. Aggregates the
--                                  latest view by (plan, as_of_date,
--                                  asset_class), summing sub-sleeves
--                                  back up to the parent asset class.
--
-- --- Edge cases the formulations protect against -----------------------
--
-- 1. Cross-document snapshot mixing in the latest view.
--    A literal "latest as_of_date per (plan, asset_class, sub_class)"
--    can mix dates within one asset_class when a plan re-ingests a
--    CAFR that drops a sub-sleeve. Example: FY2025 ACFR rolls Public
--    Equity up to a single row (sub_class=NULL) but FY2024 had it
--    split into Domestic + International. The literal formulation
--    would surface the FY2025 parent AND the FY2024 children, which
--    double-counts in the rollup. Safer formulation used here: pick
--    max(as_of_date) per (plan, asset_class) and return all
--    sub-sleeves of THAT date -- so the asset_class is always
--    represented by exactly one CAFR's worth of rows.
--
-- 2. Target-only plans in the rollup actual_pct sum.
--    Some plans publish target_pct in the CAFR but no actual_pct
--    (Ohio PERS, WSIB, NJ DOI, etc. -- see audit H-1). When a
--    sub-sleeve has actual_pct=NULL, plain SUM treats it as 0 and
--    silently overstates the rollup actual. Guarded with
--      case when bool_and(actual_pct is not null)
--           then sum(actual_pct) else null end
--    so the rollup actual is NULL whenever ANY contributing
--    sub-sleeve is target-only. Same guard on actual_usd. The hero
--    math (privateMarketsUnfundedSummary) already treats NULL actual
--    as "target-only / unknown" and excludes it from the headline.
--
-- --- Security ---------------------------------------------------------
--
-- security_invoker = on so the underlying table's RLS policy
-- (pension_allocations_read_authenticated) applies to view reads.
-- Without this flag the views would run as the view owner and bypass
-- RLS -- the wrong default in Supabase.

create index if not exists idx_pension_allocations_plan_class_date
  on public.pension_allocations (plan_id, asset_class, as_of_date desc);

create or replace view public.pension_allocations_latest
  with (security_invoker = on)
as
with latest_dates as (
  select plan_id, asset_class, max(as_of_date) as latest_as_of
  from public.pension_allocations
  group by plan_id, asset_class
)
select pa.*
from public.pension_allocations pa
join latest_dates ld
  on pa.plan_id = ld.plan_id
  and pa.asset_class = ld.asset_class
  and pa.as_of_date = ld.latest_as_of;

comment on view public.pension_allocations_latest is
  'Most-recent CAFR snapshot per (plan, asset_class). Includes every sub_class sub-sleeve from that snapshot. Older fiscal-year rows live in the underlying table for trend analysis.';

create or replace view public.pension_allocations_rollup
  with (security_invoker = on)
as
select
  plan_id,
  as_of_date,
  asset_class,
  sum(target_pct)::numeric(7, 2) as target_pct,
  case
    when bool_and(actual_pct is not null) then sum(actual_pct)::numeric(7, 2)
    else null
  end as actual_pct,
  case
    when bool_and(actual_usd is not null) then sum(actual_usd)
    else null
  end as actual_usd,
  max(total_plan_aum_usd) as total_plan_aum_usd,
  bool_or(preliminary) as preliminary,
  count(*)::int as sub_class_count
from public.pension_allocations_latest
group by plan_id, as_of_date, asset_class;

comment on view public.pension_allocations_rollup is
  'Latest snapshot rolled up to one row per (plan, asset_class). Sub-sleeves summed; actual_pct / actual_usd are NULL if any sub-sleeve was target-only.';

grant select on public.pension_allocations_latest to authenticated, service_role;
grant select on public.pension_allocations_rollup to authenticated, service_role;
