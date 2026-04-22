-- Phase 3, part 2 — GP-side signals.
-- Mirrors migration 20260421000008_gp_press_releases for the signals table.
-- A Blackstone fund-close press release yields signals with no single
-- owning pension plan: there may be zero named LPs, or many. We therefore
-- make signals.plan_id nullable and add signals.gp_id, same shape as
-- documents.
--
-- Application-level invariant (not enforced in DB, matching the migration 8
-- precedent): exactly one of {plan_id, gp_id} is non-null per row.
--
-- rejected_signals is updated identically so the classifier's low-confidence
-- reject path can log press-release output too.

-- 1. signals.plan_id nullable + gp_id FK
alter table public.signals
  alter column plan_id drop not null;

alter table public.signals
  add column if not exists gp_id uuid references public.gps(id) on delete cascade;

create index if not exists signals_gp_idx
  on public.signals (gp_id, created_at desc)
  where gp_id is not null;

comment on column public.signals.gp_id is
  'FK to gps for signals derived from GP-side press releases. Either plan_id or gp_id should be set per row; never both, never neither. Enforced in application code.';

-- 2. rejected_signals.plan_id nullable + gp_id FK (same shape as signals)
alter table public.rejected_signals
  alter column plan_id drop not null;

alter table public.rejected_signals
  add column if not exists gp_id uuid references public.gps(id) on delete cascade;

create index if not exists rejected_signals_gp_idx
  on public.rejected_signals (gp_id, created_at desc)
  where gp_id is not null;

comment on column public.rejected_signals.gp_id is
  'FK to gps for rejection-log entries derived from GP press releases. Either plan_id or gp_id should be set per row.';
