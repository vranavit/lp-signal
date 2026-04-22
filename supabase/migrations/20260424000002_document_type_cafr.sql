-- Day 4: extend documents.document_type CHECK constraint to include
-- 'cafr' (Comprehensive Annual Financial Report) and 'investment_policy'
-- (Investment Policy Statement). No existing rows become invalid; this is
-- semantically additive, but per Day 4 sprint policy DROP+ADD on a check
-- constraint requires manual application by the user in Supabase SQL Editor.
--
-- Safe to run while the app is live — no table rewrite.

alter table public.documents
  drop constraint if exists documents_document_type_check;

alter table public.documents
  add constraint documents_document_type_check
  check (document_type in (
    'board_minutes',
    'press_release',
    'annual_report',
    'agenda',
    'gp_press_release',
    'cafr',
    'investment_policy',
    'other'
  ));

comment on constraint documents_document_type_check on public.documents is
  'Added cafr + investment_policy on 2026-04-24 for Day 4 portfolio allocation ingestion.';
