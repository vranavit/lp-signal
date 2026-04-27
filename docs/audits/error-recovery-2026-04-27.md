# Error recovery: stale credit-quota documents - 2026-04-27

One-shot data correction. No code or schema changes shipped.

## Background

On 2026-04-24, an Anthropic API credit-balance event hit during the NJ DOI
and VRS board-minutes ingestion run. 35 documents were stored in Supabase
Storage successfully but their classification calls returned
`400 invalid_request_error: Your credit balance is too low`. The classifier
caught the error and parked each document at `processing_status='error'`
with the API response body in `documents.error_message`. One additional
NJ DOI document failed with `storage download failed: Bad Gateway` from
Supabase Storage during the same window (transient 5xx, not classifier
related). Total: 36 stuck documents.

The freshness-gap audit on 2026-04-27 identified these as the highest-
priority "stuck good data" recovery target: PDFs were already in storage,
no signals had been emitted, and the underlying error class was a
transient infra event, not a real classifier rejection.

## Population

| Plan | Doc type | Error class | Count |
|---|---|---|---|
| New Jersey Division of Investment | board_minutes | credit_quota | 19 |
| New Jersey Division of Investment | board_minutes | storage_5xx (Bad Gateway) | 1 |
| Virginia Retirement System | board_minutes | credit_quota | 16 |
| **Total** | | | **36** |

All 36 had `storage_path` populated, zero attached signals, and
`created_at = 2026-04-24`.

## Procedure

1. Read-only identify query (filter on
   `error_message ILIKE '%credit balance is too low%'` plus storage 5xx
   patterns) returned exactly 36 rows.
2. Reset transaction inside one BEGIN/COMMIT in pg with pre-flight count
   guard (36 expected). Updated `processing_status='pending'`,
   `error_message=null`, `processed_at=null`, `api_tokens_used=null`.
3. Ran `pnpm tsx scripts/classify-pending.ts 50` from local terminal.
   Walltime 523s (~8.7 minutes), 1.12M tokens consumed.
4. Verification queries confirmed per-plan signal counts and identified
   one new failure mode.

## Result

- 35 of 36 documents (97%) reclassified to `processing_status='complete'`.
- 1 document failed with a NEW error class (see below).
- 65 signals created across the 35 successful documents:
  - NJ DOI: 63 signals (62 T1 commitments + 1 T2 target change), 31
    accepted and 32 preliminary.
  - VRS: 2 signals (1 accepted T1, 1 preliminary T1).
- Total committed capital surfaced: **$14.24B** in formerly-invisible LP
  commitments now indexed.

VRS yielded fewer signals than NJ DOI because most VRS docs are committee
materials (Benefits & Actuarial Committee, Audit & Compliance, Defined
Contribution Plans Advisory) that contain governance content rather than
investment commitments. Only the Board of Trustees materials packets
contain commitment language. NJ DOI's 19 SIC Approved Minutes docs are
signal-dense: each meeting ratifies several pension-fund commitments
(~3.3 T1 signals per doc).

## Cost

- Anthropic API spend: 1,119,373 tokens at Sonnet 4.6 blended ~$4.20/M
  = **~$4.70**.
- Wall clock: 8.7 minutes for 36 docs.
- Active operator time: ~10 minutes of supervision.

Within the $5-20 estimate Phase 3 budgeted for the recovery.

## Deferred failure

One document failed with a different error class:

- Doc `41db7445-...` - NJ DOI `RegularMinutesJuly302025.pdf`
- New error: `classifier output failed schema validation: signals was
  stringified and jsonrepair could not recover (Colon expected at
  position 616)`
- Cause: Anthropic non-determinism. Per `lib/classifier/schema.ts:90-96`
  the API occasionally returns the `signals` array as a JSON-encoded
  string instead of an array. Our `jsonrepair` preprocess usually
  recovers but this particular response had a malformed inner structure.
- Recommended fix: retry once. Anthropic responses are non-deterministic
  so a fresh call will likely succeed.
- Deferred to the future admin-button work (Step 6) so the recovery
  isn't blocked on a 1-doc edge case.

## Resettable-pattern allowlist (for the future admin button)

The persistent "Reset error documents to pending" button on
`/admin/ingestion` should reset only documents whose `error_message`
matches one of these recoverable patterns. Anything else needs targeted
investigation.

| Pattern (ILIKE) | Why it's recoverable |
|---|---|
| `%credit balance is too low%` | Anthropic 400 from past credit-quota event; PDF still in storage, retry succeeds once credit is restored |
| `%storage download failed%` / `%bad gateway%` | Transient Supabase Storage 5xx; PDF is fine, retry succeeds |
| `%anthropic%5xx%` / `%internal_server_error%` / `%api_error%` (when seen) | Transient Anthropic infra issue; retry succeeds |
| `%network%timeout%` / `%ETIMEDOUT%` | Transient network blip; retry succeeds |
| `%signals was stringified%` / `%jsonrepair could not recover%` | Anthropic non-determinism (the deferred case above); retry on a fresh call usually succeeds |

NOT in the allowlist (these need real fixes, not blind retry):

| Pattern | Why retry won't help |
|---|---|
| `%out_of_scope%` | Intentional classifier rejection (transcripts, governance-only docs). The doc is correctly marked. |
| `%too_long%` | Document exceeds page-cap. Needs retag to `agenda_packet` to route through the keyword extractor, OR a prompt change. |
| `%schema validation%` (excluding the stringified case above) | Real prompt gap. The classifier returned a structurally valid response that doesn't match our Zod schema. Needs investigation per-doc. |
| `%pdf_parse_failed%` | Already handled by the unpdf fallback; if it shipped both errors the PDF is genuinely unparseable. |

## Remaining error rows (NOT in scope for this recovery)

13 error rows remain in the database after this recovery. These are real
classifier or content issues that won't recover from a blind retry:

| Plan | Error class | Count |
|---|---|---|
| CalPERS | out_of_scope (transcripts) | 3 |
| CalPERS | schema_validation | 4 |
| CalPERS | too_long | 1 |
| Minnesota State Board of Investment | too_long | 2 |
| New Jersey Division of Investment | schema_validation | 2 |
| Washington State Investment Board | schema_validation | 1 |

These are baseline acceptable error rate (~3% of total documents). A
"prompt gap fix" sprint could investigate the 7 schema_validation cases
to determine whether they signal a real classifier shortfall or an
extraction edge case. Out of scope for this recovery.

## Status

- Sub-project A of the freshness-gap closure: **complete** (35 of 36
  recovered, 1 deferred to admin button work).
- Step 6 (persistent admin button on `/admin/ingestion`): deferred to
  a future session. The allowlist above is the input spec.
- Move to sub-project B (CAFR auto-ingestion).
