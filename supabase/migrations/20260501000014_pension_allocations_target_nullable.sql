-- 2026-04-26: allow pension_allocations.target_pct to be NULL.
--
-- Phase-3 Round 2 of the actuals-gap sprint (v1.3-cafr classifier).
--
-- Some sources publish actuals without restating policy targets — the
-- canonical example is the NCRS Quarterly Investment Report, which
-- explicitly references the Investment Policy Statement at
-- https://www.nctreasurer.gov/media/1501/open as the policy-target
-- source. The classifier (v1.3-cafr) emits actual-only rows for those
-- sources, gated on an explicit IPS cross-reference.
--
-- Symmetric integrity: cafrAllocationResponseSchema's Zod .refine() and
-- the audit script's Check 6 enforce that at least one of (target_pct,
-- actual_pct) is non-null. We add a CHECK constraint here so direct DB
-- writes (e.g. backfill scripts) can't bypass that rule.
--
-- The pension_allocations_latest and pension_allocations_rollup views
-- already handle NULL target_pct correctly (sums treat NULL as 0 in the
-- rollup, but the underlying latest view preserves NULLs for
-- target-side queries).

alter table public.pension_allocations
  alter column target_pct drop not null;

alter table public.pension_allocations
  add constraint pension_allocations_target_or_actual_check
  check (target_pct is not null or actual_pct is not null);
