-- Confidence-tiered auto-approval, part 1/2.
--
-- Adds the `preliminary` flag and `prompt_version` to signals.
--
-- Routing (applied by the classifier at insert time):
--   confidence >= 0.85 AND priority_score >= 40  → preliminary = false
--   confidence >= 0.85 AND priority_score <  40  → preliminary = true
--   confidence >= 0.70 AND confidence  <  0.85   → preliminary = true
--   confidence <  0.70                           → inserted into rejected_signals (see part 2/2)
--
-- Existing rows get preliminary = false by default, matching the manual
-- approvals from 2026-04-21.

alter table public.signals
  add column if not exists preliminary    boolean not null default false,
  add column if not exists prompt_version text;

create index if not exists signals_preliminary_idx
  on public.signals (preliminary)
  where preliminary = true;

comment on column public.signals.preliminary is
  'True when the signal was auto-published but needs a visible caveat (mid confidence, or high confidence + low priority). See rejection routing in lib/classifier/index.ts.';

comment on column public.signals.prompt_version is
  'Classifier prompt version at time of extraction (e.g. "v2.0"). Null for rows written before versioning was introduced.';
