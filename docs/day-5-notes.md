# Day 5 — Build Notes

## Task 2: NYSCRF preliminary spot-check verdict

**Result: 9 of 9 preliminary allocations clearly correct. Bumped to accepted.**

All 9 allocations cite page 139 of the NYSCRF 2025 ACFR. Verbatim quotes
match NYSCRF's publicly-known FY 2025 target allocation policy, which sums
to 100% exactly:

| Asset                     | Target  | Rate of Return |
|---------------------------|---------|----------------|
| Domestic equities         | 32%     | 4.00%          |
| International equities    | 15%     | 6.65%          |
| Private equity            | 10%     | 7.25%          |
| Real estate               | 9%      | 4.60%          |
| Fixed income              | 23%     | 1.50%          |
| Credit                    | 4%      | 5.40%          |
| Real assets (Infra)       | 3%      | 5.79%          |
| Opportunistic / Absolute  | 3%      | 5.25%          |
| Cash                      | 1%      | 0.25%          |

### Why the classifier under-calibrated

- Page 139 of a 310-page doc — model hedges on "is this the primary policy
  table or a supplementary discount-rate exhibit?".
- Table frames the target as an input to the long-term expected-rate-of-
  return calculation rather than a "here is our policy" statement. Model
  treated this as policy-adjacent.

### Action taken

Bumped confidence on all 9 rows to `0.90` and `preliminary = false` via a
one-off SQL update. No schema change. No prompt change required — the
extraction was correct; the confidence band was conservative.

### Future prompt tweak (for Day 6+)

Add to the calibration section of `cafr-allocation.ts`:

> If the target percentages are presented in the context of an expected-
> return / discount-rate table (common in CAFR Notes to Financial
> Statements), treat them as the primary policy target with confidence
> 0.85+ — the rate-of-return column is derived from, not a substitute for,
> the policy target column.

### Sub-category split note

The NYSCRF ACFR distinguishes "Domestic equities 32%" and "International
equities 15%" as separate rows. Our `asset_class` enum has only
"Public Equity", so both land as duplicate Public Equity rows. Rolling
them up (to 47%) loses information; keeping them split surfaces the geo
mix. Day 6+ decision: extend the enum with "Public Equity — Domestic" /
"Public Equity — International" OR persist the sub-category in a separate
`sub_class` column.
