-- 2026-04-26: extend pension_allocations_rollup with policy-range columns.
--
-- Background: docs/audits/duplicate-allocations-audit-2026-04-25.md "Issue 2"
-- and the follow-up agreement to ship range-aware gap classification (B2 in
-- session notes). The hero unfunded-budget math in lib/relevance/unfunded.ts
-- needs target_min_pct so it can compute (min - actual) instead of the
-- naive (target - actual), which over-counts in-range underweights as
-- "unfunded budget" even when policy says they're fine.
--
-- Range columns surface only when sub_class_count = 1. When multiple
-- sub-sleeves share an asset_class their ranges don't aggregate -- each
-- sleeve has its own band, and the parent's "range" is undefined. NULL is
-- the honest answer there. The latest view still carries per-row range so
-- child rows in the UI render their own ranges directly.

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
  count(*)::int as sub_class_count,
  case
    when count(*) = 1 then min(target_min_pct)::numeric(7, 2)
    else null
  end as target_min_pct,
  case
    when count(*) = 1 then max(target_max_pct)::numeric(7, 2)
    else null
  end as target_max_pct
from public.pension_allocations_latest
group by plan_id, as_of_date, asset_class;

comment on view public.pension_allocations_rollup is
  'Latest snapshot rolled up to one row per (plan, asset_class). Sub-sleeves summed; actual_pct / actual_usd are NULL if any sub-sleeve was target-only. target_min_pct / target_max_pct surface only when sub_class_count = 1 (ranges do not aggregate).';
