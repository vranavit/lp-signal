-- Cross-source verification tracking
-- Per build spec v2.0 Section 10
-- Resolution: 2026-04-30 (calendar) / Day 5 of Week 1 sprint
--
-- Records verifications between two records (currently only allocation-
-- allocation pairings; signal-signal and consultant-consultant pairings
-- planned for later weeks). The `least`/`greatest` unique index makes
-- (A, B) and (B, A) collide so re-running the verifier on the same pair
-- doesn't produce duplicates.

create table if not exists public.source_verifications (
  id uuid primary key default gen_random_uuid(),
  -- The two records being verified as same/different event
  record_a_type text not null check (record_a_type in ('signal', 'allocation', 'consultant')),
  record_a_id uuid not null,
  record_b_type text not null check (record_b_type in ('signal', 'allocation', 'consultant')),
  record_b_id uuid not null,
  -- Verification outcome
  verification_type text not null check (verification_type in ('confirms', 'partially_confirms', 'conflicts', 'unrelated')),
  confidence decimal(3,2) check (confidence >= 0 and confidence <= 1),
  rationale text,
  -- Provenance
  verifier_version text not null,  -- e.g., 'v1.0-allocation'
  created_at timestamptz default now()
);

-- Prevent duplicate verifications between the same pair (order-insensitive)
create unique index if not exists source_verifications_pair_idx
  on public.source_verifications (
    least(record_a_id::text, record_b_id::text),
    greatest(record_a_id::text, record_b_id::text),
    verifier_version
  );

-- Index for finding all verifications touching a given record
create index if not exists source_verifications_record_a_idx
  on public.source_verifications (record_a_id, record_a_type);
create index if not exists source_verifications_record_b_idx
  on public.source_verifications (record_b_id, record_b_type);
