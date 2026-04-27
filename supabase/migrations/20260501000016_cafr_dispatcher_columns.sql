-- Sub-project B PR 4: CAFR auto-ingest dispatcher columns.
--
-- /api/cron/scrape-cafr refactors from "hash-the-landing-page" (read-only
-- heartbeat) to "probe via adapter, ingest if PDF found" (active dispatcher).
-- Three new columns capture per-source dispatcher state:
--
-- - consecutive_failures: failure-escalation counter. 1 = normal mention in
--   digest, 2 = HIGH PRIORITY in digest subject, 3 = quarantine. Resets to 0
--   on any successful run (ingested / deduped / empty).
-- - quarantined_at: dispatcher skip lock. NULL = probe normally; non-null =
--   skip. Set automatically on 3rd consecutive sourceFailure. Cleared
--   manually via SQL UPDATE.
-- - last_outcome_kind: most recent dispatcher outcome. Lets /admin/ingestion
--   render colored badges per outcome without regex-parsing
--   last_run_summary. NULL on rows that predate this PR.
--
-- Additive only; no data migration needed. Existing rows take defaults; the
-- dispatcher writes the new columns on its first run.

alter table public.scrape_fingerprints
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists quarantined_at timestamptz,
  add column if not exists last_outcome_kind text;

alter table public.scrape_fingerprints
  add constraint scrape_fingerprints_last_outcome_kind_check
  check (
    last_outcome_kind is null
    or last_outcome_kind in (
      'ingested',
      'deduped',
      'empty',
      'sourceFailure',
      'infraFailure'
    )
  );

comment on column public.scrape_fingerprints.consecutive_failures is
  'Per-source failure-escalation counter. Increments on sourceFailure outcome; resets to 0 on ingested/deduped/empty success. quarantined_at is set when this reaches 3.';
comment on column public.scrape_fingerprints.quarantined_at is
  'When non-null, the dispatcher skips this source. Set automatically on 3rd consecutive sourceFailure; cleared manually via SQL UPDATE.';
comment on column public.scrape_fingerprints.last_outcome_kind is
  'Most recent dispatcher outcome (ingested|deduped|empty|sourceFailure|infraFailure). Rendered as colored badges on /admin/ingestion. NULL on rows predating PR 4.';
