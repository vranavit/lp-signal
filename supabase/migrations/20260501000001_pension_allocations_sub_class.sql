-- Day 9.5 · H-2: sub_class column on pension_allocations.
--
-- Some CAFR policy tables distinguish sub-sleeves inside a single asset
-- class with their own policy targets and ranges (not implementation
-- sub-strategies — those still roll up). Examples:
--   NYSCRF Public Equity → Domestic 32% / International 15%
--   TRS Texas Public Equity → USA 18% / Non-US Developed 13% / Emerging 9%
--   CalSTRS Other → Risk Mitigating Strategies 10% / Collaborative Strategies 0%
--   CalPERS Fixed Income → Fixed Income 23% / TIPS 5%
--   TRS Texas Other → Risk Parity / Stable Value HF / Absolute Return / Commodities
--
-- Before this column these appeared as (plan_id, as_of_date, asset_class)
-- duplicates in the DB, causing at least one false-positive policy-change
-- alert (CalSTRS "Other 10% → 0%" — actually the Risk Mitigating vs
-- Collaborative split).
--
-- Nullable: most rows have no sub-sleeve distinction and stay NULL.
-- Unique index on (plan_id, as_of_date, asset_class, coalesce(sub_class,''))
-- is applied in the follow-up migration 20260501000002_* AFTER the
-- backfill script writes sub_class values on the 17 existing duplicate
-- rows — applying it now would fail on the current duplicates.

alter table public.pension_allocations
  add column if not exists sub_class text;

comment on column public.pension_allocations.sub_class is
  'Sub-sleeve label within asset_class when the CAFR policy table distinguishes policy targets inside a class (e.g. Public Equity → Domestic / International / Emerging Markets). Verbatim from the source table. NULL when no sub-sleeve distinction exists, which is the common case.';
