-- Phase 2 — classifier telemetry
-- Records input+output tokens consumed per document classification so we can
-- attribute API spend and catch prompt regressions.

alter table public.documents
  add column if not exists api_tokens_used int;

comment on column public.documents.api_tokens_used is
  'Total (input + output) tokens consumed by the classifier for this document. Null until classified.';
