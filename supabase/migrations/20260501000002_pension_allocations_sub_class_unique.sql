-- Day 9.5 · H-2 follow-up: unique index after sub_class backfill.
--
-- Apply AFTER scripts/backfill-allocation-sub-class.ts has run and the
-- existing 17 sub-sleeve-duplicate rows carry distinct sub_class values.
-- The classifier's v1.1-cafr prompt will populate sub_class on future
-- ingestions so this index stays green.
--
-- coalesce(sub_class,'') in the expression lets rows with sub_class=NULL
-- still participate in the uniqueness check (so we don't accidentally
-- allow two 'PE' rows at the same as_of_date with no sub-sleeve label).

create unique index if not exists pension_allocations_unique_idx
  on public.pension_allocations (
    plan_id,
    as_of_date,
    asset_class,
    coalesce(sub_class, '')
  );
