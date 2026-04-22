-- Phase 2 — human-in-the-loop validation gate.
-- Real signals are hidden from the dashboard until an operator approves them
-- on /signals/review. Seeds remain visible regardless (seed_data = true).
-- Dashboard query filters: validated_at IS NOT NULL OR seed_data = true.

alter table public.signals
  add column if not exists validated_at timestamptz;

create index if not exists signals_validated_idx
  on public.signals (validated_at desc)
  where validated_at is not null;

comment on column public.signals.validated_at is
  'Timestamp when an operator approved this signal on /signals/review. Null = pending review.';
