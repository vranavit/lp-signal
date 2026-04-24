-- Day 10 agenda-packet routing: extend documents.document_type CHECK to
-- include the LACERA-specific kinds. Additive; no existing rows are
-- invalidated.
--
--   agenda_packet      - multi-hundred-page Board of Investments agenda
--                        packet (typical LACERA _boi_agnd.pdf, 400-750
--                        pages). Signal density is low: ~5-10 pages of
--                        commitment votes buried in performance
--                        analytics + manager presentations. Routed
--                        through lib/classifier/extract-commitment-pages
--                        instead of the full-PDF pension path.
--   board_approvals    - LACERA BOI_MM-DD-YY_reportout.pdf -- short
--                        summary of the BOI's approved actions per
--                        meeting. Classified through the standard
--                        pension path.
--   performance_report - placeholder for future quarterly / annual
--                        performance reports; no scraper emits this
--                        today, included so the constraint matches the
--                        Task spec's allowed value list.
--
-- Safe to run live; no table rewrite.

alter table public.documents
  drop constraint if exists documents_document_type_check;

alter table public.documents
  add constraint documents_document_type_check
  check (document_type in (
    'board_minutes',
    'board_approvals',
    'agenda',
    'agenda_packet',
    'press_release',
    'gp_press_release',
    'annual_report',
    'performance_report',
    'cafr',
    'investment_policy',
    'other'
  ));

comment on constraint documents_document_type_check on public.documents is
  'Added agenda_packet + board_approvals + performance_report on 2026-04-24 for LACERA agenda-packet extraction routing.';
