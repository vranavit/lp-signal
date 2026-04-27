-- 2026-04-26: prevent duplicate T1 commitment signals via natural-key unique index.
--
-- Phase-3 of the dedupe sprint (commit pending). After Q1 + Q2/Q3 cleanup
-- landed (T1 count 479 -> 330), this index ensures the same commitment
-- cannot be re-inserted by re-classifying a document that mentions a fact
-- we already captured from a different source.
--
-- Natural key: (plan_id, fields->>'gp', fields->>'fund_name',
--               commitment_amount_usd, coalesce(fields->>'approval_date', '__null__')).
--
-- approval_date is COALESCEd to '__null__' so two rows with both lacking a
-- date still collide (they are the same fact described twice without a date).
-- A NULL would otherwise be treated as distinct by default, defeating dedup.
--
-- Partial index on signal_type = 1 AND seed_data = false:
--   - T2/T3 signals have different fields shapes (target_pct / pacing_usd
--     instead of gp / fund_name); not in scope for this index.
--   - seed_data = false excludes the original seed row which uses the legacy
--     'gp_name' JSONB key instead of 'gp', so it cannot collide anyway, but
--     filtering it out documents intent.
--
-- Companion change to lib/classifier/index.ts: T1 inserts get an upsert with
-- ON CONFLICT DO NOTHING semantics so the classifier can keep emitting facts
-- it sees in newly-ingested documents without throwing on the second mention.

create unique index if not exists signals_t1_natural_key_idx
  on public.signals (
    plan_id,
    (fields->>'gp'),
    (fields->>'fund_name'),
    commitment_amount_usd,
    coalesce(fields->>'approval_date', '__null__')
  )
  where signal_type = 1 and seed_data = false;

comment on index public.signals_t1_natural_key_idx is
  'Unique natural key for T1 commitment signals. Prevents the same commitment from being re-inserted when scrapers re-run or when multiple documents mention the same fact. Added 2026-04-26 in Phase-3 of the dedupe sprint.';
