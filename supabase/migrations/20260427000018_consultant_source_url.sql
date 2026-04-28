-- Workstream 2 Phase A Block 4: external source URLs for consultant
-- relationships sourced from outside the documents pipeline.
--
-- The existing source_document_id column requires an actual row in
-- public.documents (CAFR PDFs we've ingested + classified via the
-- v1.5-consultants pipeline). For consultant relationships sourced via
-- verified web research - state procurement portals, board minutes we
-- don't currently scrape, press releases, plan disclosures - there is
-- no documents row to point at, so we capture the verifying URL
-- directly on the relationship row.
--
-- Convention (enforced at the application layer, not via CHECK):
--   - source_type='cafr_extraction' -> source_document_id set,
--     source_url NULL.
--   - source_type='industry_knowledge' / 'rfp_database' /
--     'press_release' / 'plan_disclosure' -> source_url set with the
--     verifying URL, source_document_id NULL.
--   - source_excerpt always contains the verbatim text from the URL
--     (or document) confirming the consultant relationship.
--
-- Not a CHECK constraint: allows transitional states where a row
-- exists without complete provenance (e.g. a manual entry pending URL
-- lookup). The Block 4 manual-research SQL inserts will populate
-- source_url + source_excerpt together.
--
-- Existing CAFR-extracted rows (52 as of this migration) keep
-- source_url NULL - their provenance is already captured via
-- source_document_id.

alter table public.plan_consultants
  add column if not exists source_url text;

comment on column public.plan_consultants.source_url is
  'External URL where the consultant relationship is documented (procurement portal, board minutes outside our scrape coverage, press release, plan disclosure). Populated when source_type is industry_knowledge / rfp_database / press_release / plan_disclosure. NULL for source_type=cafr_extraction (use source_document_id instead).';
