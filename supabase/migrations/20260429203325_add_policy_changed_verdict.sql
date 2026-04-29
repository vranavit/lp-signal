-- Add 'policy_changed' verdict to source_verifications.
-- Day 6 of Week 1 sprint. Resolution: 2026-04-30.
--
-- Day 5 v1.0 verifier conflated two different questions: "is this the
-- same policy?" and "did the policy change?". Day 6 v1.1 introduces
-- the 'policy_changed' verdict for pairs that fall within an IPS
-- adoption window but show legitimate mid-cycle revisions. See
-- docs/architecture/cross-source-verification-semantics.md.

alter table public.source_verifications
  drop constraint if exists source_verifications_verification_type_check;

alter table public.source_verifications
  add constraint source_verifications_verification_type_check
  check (verification_type in (
    'confirms',
    'partially_confirms',
    'policy_changed',
    'conflicts',
    'unrelated'
  ));
