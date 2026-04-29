# Fix 5 Phase 2 — fee_period backfill (2026-04-29)

Audit refs: Audit 1 P2.7, Audit 2 P2.3, Audit 4 P4.1, P4.2

## What was applied

Backfilled `plan_consultants.fee_period` for 55 of 75 rows.
20 rows correctly remain NULL.

| source_type | fee_period | count | rationale |
|---|---|---|---|
| cafr_extraction | annual | 53 | Bulk-tagged based on CAFR source convention. ACFR Schedules of Investment Expenses are universally annual fiscal-year basis in U.S. public pension plans. |
| manual_research | quarterly | 2 | SWIB StepStone PE + RE. Verified by Audit 1 Phase 4 deep-scan finding the explicit "Total Quarterly Charges to Funds" footer in all 4 sampled SWIB Board packets. |
| manual_research | NULL | 20 | All 20 manual rows have fee_usd = NULL. fee_period documents the period basis of fee_usd; with no fee value, period is structurally orphan. NULL is the honest disposition. |
| **Total** | | **75** | |

## Notes annotations

Each updated row received a notes annotation explaining:

- Why fee_period was set to that value
- The audit reference and date
- For 'annual' bulk tags: the explicit caveat that if a
  specific source CAFR uses non-annual schedule, the row
  needs re-extraction
- For 'quarterly' SWIB tags: reference to Phase 4 deep-scan
  methodology and the "Total Quarterly Charges to Funds"
  footer evidence

## What was NOT applied

- 20 manual_research rows with fee_usd = NULL: no period
  assigned. Pattern check: each row is a
  relationship-confirmation source (RFP press, board minutes,
  IPS partner page, news coverage) — not fee schedules. None
  has a primary disclosure of an annual fee value with
  period basis disclosed.

- 1 row deserves explicit flagging: SWIB Aksia (HF). Notes
  field references "Q4 2021 fee disclosed as 93,750 per
  Markets Group September 2022" — a known quarterly fee
  value. Following the P2.3 reframe precedent (single-quarter
  disclosure can't be backfilled to annual without
  speculation), fee_usd stays NULL → fee_period stays NULL.

## Verification

Pre-Phase-2: 75 rows, all fee_period = NULL.

Post-Phase-2: 75 rows, 53 annual / 2 quarterly / 20 NULL.

Critical invariant: zero rows have fee_period = NULL with
fee_usd populated. Every fee value has a period attached.

## Cross-references

- Phase 1 (schema): commit `ec59577`
- Phase 3 (classifier prompt): pending
- Phase 4 (UI render): pending
- Phase 5 (audit doc closure): pending

## Methodology note

Phase 2 used the bulk-tag-by-source-type approach with
targeted overrides for known cases. Per-row review of 75 rows
was considered but rejected as overkill when source_type
reliably indicates period basis for cafr_extraction (always
annual fiscal-year ACFRs) and notes/excerpt review handles
the manual research edge cases.
