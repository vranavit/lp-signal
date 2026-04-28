-- Add fee_period column to plan_consultants for distinguishing
-- annual retainers from quarterly accruals, YTD-cumulative,
-- or monthly disclosures.
--
-- Surfaced by Audit 1 P2.7 (data integrity audit, 2026-04-28)
-- when SWIB Board fee schedules were confirmed as quarterly,
-- making fee_usd backfill misleading without a period
-- disambiguator.
--
-- Audit refs: Audit 1 P2.7, Audit 2 P2.3, Audit 4 P4.1, P4.2
-- Resolution: 2026-04-29 (Phase 1 of 5: schema only)

alter table public.plan_consultants
  add column if not exists fee_period text
  check (fee_period in ('annual', 'quarterly', 'ytd', 'monthly'));

comment on column public.plan_consultants.fee_period is
  'Period basis for fee_usd. Distinguishes annual retainer from quarterly accrual, year-to-date cumulative, or monthly disclosure. NULL when period basis is unknown or not yet captured. Backfilled for known cases in a follow-up Phase 2 migration.';
