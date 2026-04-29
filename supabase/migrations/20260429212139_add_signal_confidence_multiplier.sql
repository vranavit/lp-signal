-- Cross-source verification multiplier on signals.
-- Day 8 of Week 2 sprint (Day 1). Resolution: 2026-04-30.
--
-- Per build spec v3 Section 3 + Section 4 priority scoring note.
-- Multiplier values: 1.0 single-source / 1.5 two-source / 2.0 three+
-- source. A "source" is a distinct confirming source_verifications
-- row (confirms / partially_confirms / policy_changed). Conflicts
-- and unrelated do NOT count.
--
-- Display logic computes effective rank as
--   priority_score * confidence_multiplier
-- Keeping the two columns separate (rather than baking the multiplier
-- into priority_score) preserves the classifier-emitted base score so
-- both components are independently observable.

alter table public.signals
  add column if not exists confidence_multiplier numeric(3,2)
    not null default 1.0
    check (confidence_multiplier between 1.0 and 2.0);
