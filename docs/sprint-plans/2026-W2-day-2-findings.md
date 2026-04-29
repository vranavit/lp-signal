# Week 2 Day 2 Findings (calendar Day 9)

Date: 2026-04-30 (calendar continues; Day 9 of the Month 1 sprint, Day 2 of Week 2)

## Headline

Day 9 was investigation, not implementation. Day 9 Phase 1 disproved two of the three "Week 1 known data quality findings" (CalSTRS Public Equity 4pp gap and CalSTRS Fixed Income 1pp gap are real multi-year policy drift, not extraction errors). Phase 2 located the source of the CalPERS PE 17% / Public Equity 37% extractions: page 60 of the ACFR-2025 has a "Strategic Asset Allocation" table that the classifier extracted from for those rows, while page 126 has the "Asset Allocation - PERF" table with Interim Policy Target Weight that the classifier extracted from for other rows. The ingestion mixes values from both tables. Day 9 corrects the factually-wrong Week 1 doc claims and documents a verifier limitation; it does NOT fix the underlying extraction issue (deferred to Day 10).

## Phase 2A: locating 17% and 37%

The CalPERS ACFR-2025 (`acfr-2025/download`, 259 pages) was downloaded from Storage and searched. Both target values appear in the "Strategic Asset Allocation" table at page 60:

```
Strategic Asset Allocation (effective as of June 30, 2025)
Asset Class      | PERF A | PERF B | PERF C | LRF | JRF | JRF II
Public Equity    | 37%    | 37%    | 37%    | 7%  | -   | 43%
Private Equity   | 17%    | 17%    | 17%    | -   | -   | -
Fixed Income     | 28%    | 28%    | 28%    | 45% | -   | 29%
Real Assets      | 15%    | 15%    | 15%    | -   | -   | -
Private Debt     | 8%     | 8%     | 8%     | -   | -   | -
Strategic Leverage | (5%) | (5%)   | (5%)   | -   | -   | -
```

Page 60's prose introduces the table as: "...the Board-approved strategic asset allocation policy for the defined benefit pension plans, effective as of June 30, 2025: Strategic Asset Allocation..."

Page 126 has the operational allocation table titled "Asset Allocation - PERF" with columns "Current Allocation | Interim Policy Target Weight (as of 6/30/2025) | Asset Class | Prior Policy Target Weight (as of 6/30/2024)":

```
Public Equity     38.9%  40.4%   Public Equity     40.4%
Private Equity    17.7%  15.0%   Private Equity    15.0%
Income            30.3%  29.1%   Income            29.1%
Real Assets       13.1%  15.0%   Real Assets       15.0%
Private Debt       3.8%   3.5%   Private Debt       3.5%
```

Cross-check vs database CAFR-prompted rows:

| Row | DB target | p.60 Strategic | p.126 Interim | Source the classifier picked |
|---|---|---|---|---|
| Public Equity | **37.00%** | **37%** | 40.4% | p.60 Strategic |
| Private Equity | **17.00%** | **17%** | 15.0% | p.60 Strategic |
| Income / Fixed Income | **29.10%** | 28% | **29.1%** | p.126 Interim |
| Real Assets / RE | 15.00% | 15% | 15.0% | matches both |
| Private Debt / Credit | **3.50%** | 8% | **3.5%** | p.126 Interim |
| Liquidity / Cash | **-3.00%** target / **-6.10%** actual | (5%) Strategic Leverage on p.60 | (3.0%) Liquidity target on p.126 + Active+Strategic actuals | p.126 (target) but actuals from a different sub-section |

## Phase 2B: strategic / policy review context

Searched the ACFR for the canonical phrasing of policy table titles. Hits:

- **"Strategic Asset Allocation"**: 7 occurrences. Anchored at p.60 (PERF, LRF, JRF, JRF II, CERBTF, CEPPTF tables) and p.52 (table-of-contents reference).
- **"Asset Liability"**: 2 occurrences. p.34 ("Asset Liability Management - Defined Benefit Plans" overview); p.78 ("Long-Term Expected Real Rates of Return by Asset Class" reference table that quotes the Strategic targets).
- **"Policy Target Review"**, **"Asset Allocation Workplan"**, **"Adopted Strategic"**, **"Strategic Target"**, **"Strategic Allocation"**, **"Long-Term Target"**, **"Long Term Target"**, **"Strategic Policy Target"**: 0 occurrences each.

So the CAFR uses two canonical table titles for targets: "Strategic Asset Allocation" (long-term board-adopted) and the unnamed "Interim Policy Target Weight" column inside the "Asset Allocation - PERF" table (in-effect target as of FY end).

## Phase 2C: characterization of the bug

**Hypothesis 1 (different table that quotes IPS-adopted Strategic): partially correct.** The classifier did land on the Strategic Asset Allocation table on p.60 for Public Equity and PE. But it ALSO landed on the Interim Policy Target table on p.126 for Income, Private Debt, and Real Assets. The result is a Frankenstein extraction that mixes Strategic and Interim values across rows.

**Hypothesis 2 (narrative section): wrong.** Both 17% and 37% appear in the formal Strategic Asset Allocation table at p.60, not in narrative prose.

**Hypothesis 3 (chart caption / footnote): wrong.** Same - they're in formal tables, not captions.

**Likely root cause:** the prompt's two-table-merge rule (v1.2-cafr) instructs the classifier to traverse Notes Section (targets) AND Investment Section (actuals) and merge by asset class. When BOTH sections contain target tables (Notes has Strategic, Investment has Interim), the prompt does not specify which target table is canonical. The classifier picked rows from whichever table happened to have a clean label match for each asset class.

For Public Equity and PE, the p.60 Strategic table has clean parent-class labels ("Public Equity", "Private Equity") and the classifier matched there. For Income and Private Debt, the p.60 Strategic table uses "Fixed Income" and "Private Debt" but the actuals at p.126 use "Income" and "Private Debt" with the Interim target 29.1% / 3.5% adjacent in the same table; the classifier merged target+actual within p.126 for those rows.

**The CalPERS Cash row is its own issue.** The DB has target=-3% (matches p.126 "Liquidity (3.0%)" = -3% under parens-as-negative convention) and actual=-6.1% (matches p.126 "Active (2.3%) + Strategic (3.8%) = (6.1%)" - the financing rows, NOT the Liquidity row). The classifier merged a target from one row in the Financing & Liquidity sub-section with actuals from two different rows in the same sub-section. This is a different bug from the Strategic-vs-Interim issue: the two-table merge logic conflated rows within the same table that happened to be in adjacent positions.

## Phase 3: corrected Week 1 doc claims (CalSTRS only per scope)

Two factually-wrong claims corrected:

| Doc | Original framing | Day 9 correction |
|---|---|---|
| `2026-W1-day-4-findings.md` line 69 | "CAFR may include an additional public-equity sleeve in the parent rollup" | The CAFR explicitly states 42% / 41% / 40% across FY2023 / FY2024 / FY2025 - real policy drift toward IPS-adopted 38% long-term target |
| `2026-W1-day-4-findings.md` line 70 | "1-pt gap; minor - could be a rounding or transition-period difference" | CAFR states 12% / 12% / 13% across the three FYs - same drift pattern, real data |
| `2026-W1-day-5-findings.md` lines 80-87 | "Data quality findings confirmed" header for the 3-row table | Renamed to "Day 4 cross-source value discrepancies"; added Day 9 reframe column noting the two CalSTRS rows are policy drift, not data quality issues |

**Out of scope for Phase 3:** the CalPERS Credit row's existing "Likely cause: CAFR captured Private Debt sub-sleeve as the Credit parent (mis-aggregation in CAFR extraction)" framing is also misleading per Phase 2 evidence (the CAFR extraction is correctly reading 3.5% from the Interim Policy Target column; the gap with IPS 8% is the Strategic-vs-Interim distinction, not a sub-sleeve mis-aggregation). I added a "(under further investigation - see Day 9 findings)" note in the Day 4 row but did not rewrite the original hypothesis text. The architecture doc's line 20 ("CalPERS Credit IPS at 8% vs CAFR at 3.5%, where the CAFR extraction had likely captured a Private Debt sub-sleeve and labeled it the Credit parent") and line 52 ("CalPERS Credit, the pre-identified mis-aggregation") use the same misleading framing and were also not rewritten in this turn. Flag for Day 10 followup if you want consistent reframing.

## Phase 4: verifier limitation documented

Added a new subsection "Cross-source verification cannot detect mutual extraction errors" to `docs/architecture/cross-source-verification-semantics.md` under the existing "Known scaling concerns" section. Captures the CalPERS PE 17% example: both CAFR and IPS extractions read 17%, but the CAFR's actual Interim Policy Target column states 15.0%. The verifier saw matching values and produced `confirms`. Confirmation count is not equivalent to correctness count; source-document audits remain necessary for high-stakes claims.

## Findings categorization (Day 9 consolidated)

| Finding | Original Day 4 / Day 5 framing | Day 9 reality |
|---|---|---|
| **CalSTRS Public Equity 4pp gap** | Data quality issue (CAFR extra sleeve in rollup) | Real multi-year policy drift; CalSTRS reduced target 42% -> 41% -> 40% across 3 FYs toward IPS 38% |
| **CalSTRS Fixed Income 1pp gap** | Data quality issue (rounding / transition) | Real policy drift; CAFR explicitly states 12% / 12% / 13% across 3 FYs vs IPS 14% |
| **CalPERS Credit 4.5pp gap** | Sub-sleeve mis-aggregation (CAFR captured Private Debt as Credit parent) | Strategic-vs-Interim target distinction. CAFR has both tables; classifier extracted 3.5% from p.126 Interim. IPS shows 8% which matches p.60 Strategic. Gap is the Strategic-vs-Interim semantic difference, not a CAFR sub-sleeve error. |
| **CalPERS PE target wrong (NEW Day 9)** | n/a | Classifier extracted 17% from p.60 Strategic table; the CAFR's stated p.126 Interim target is 15.0%. |
| **CalPERS Public Equity target wrong (NEW Day 9)** | n/a | Same pattern: 37% from p.60 Strategic; CAFR's p.126 Interim says 40.4%. |
| **CalPERS Cash row inconsistent (NEW Day 9)** | n/a | Target -3% from Liquidity row; actual -6.1% from Active + Strategic financing rows. Two different concepts conflated. Was correctly flagged preliminary (conf=0.82). |
| **Non-ACFR documents tagged document_type='cafr' (NEW Day 9)** | n/a | Two CalPERS board-meeting agenda items (12 pages each) are stored as `document_type='cafr'`. The `acfr-2025` filter in Day 9 inspection had to disambiguate. They didn't produce allocation rows in the Day 6 dataset, but the misclassification could matter for future scrapes. |

## Day 10 plan (proposed)

Implementation phase. Three concrete fixes:

1. **Prompt iteration v1.4-cafr** to specify which target table is canonical when multiple exist.
   - Recommendation: prefer the table labeled "Interim Policy Target Weight (as of YYYY-MM-DD)" or equivalent "current target allocation" / "policy target weight as of fiscal year end" - the operational target that the plan is actively allocating to. The Strategic Asset Allocation table represents the long-term goal which is also captured in the IPS, so cross-source verification (CAFR Interim vs IPS Strategic) becomes meaningful: a `policy_changed` verdict reflects the CAFR's Interim target stepping toward the IPS Strategic target.
   - Add a guardrail: if the same asset class appears with different targets in two tables in the same CAFR, prefer the one in the Investment Section's Asset Allocation table (Interim) over the one in the Notes section's Strategic table.

2. **Re-extract CalPERS CAFR FY2025** with v1.4-cafr to fix the 4 broken rows (Public Equity, PE, Credit, Cash).

3. **Re-run the cross-source verifier** for CalPERS after the re-extract to update the source_verifications rows. Expected outcome: the CalPERS PE pair flips from `confirms` (artificial) to `policy_changed` (CAFR Interim 15% vs IPS Strategic 17% is a stepping target). The CalPERS Public Equity / Cap Weighted pair becomes a clearer `partially_confirms` (CAFR Public Equity Interim 40.4% vs IPS Cap Weighted 27% sub-sleeve is now a hierarchy mismatch).

4. **Optional: investigate the non-ACFR `document_type='cafr'` misclassification.** Two CalPERS board-agenda items (12 pages each) tagged as CAFRs. Probably a scraper-side classification error. Low priority unless they're feeding into other extraction paths.

## Pattern check / institutional flags

- Initial Week 1 hypotheses about the CalSTRS gaps were wrong. The pattern: when a cross-source value gap is observed, the default explanation should NOT be "extraction error." Most CAFR allocation tables are clean; the more common cause is the source itself encoding multiple legitimate values (Strategic vs Interim, multi-year drift) that look like discrepancies until you read the source PDF.
- Day 9 surfaced that **the CalPERS CAFR has two distinct policy target tables** that the v1.2-cafr prompt does not disambiguate. This is a prompt-side gap, not an extraction-side error per se. Other plans likely have similar dual-table structures (Strategic vs Interim, Long-term vs Transition); the fix needs to generalize.
- The verifier's `confirms` verdict on CalPERS PE 17%-vs-17% is artificial. Both extractions are reading from the Strategic table, so they "agree" but neither captures the actual operational target (15.0%). This is why source document audits remain necessary as a check on the verifier output, even when verdicts are `confirms`.

## Day 10 architectural decisions (queued from Day 9 cleanup)

Two architectural decisions surfaced tonight that compound each other. Both need resolution before the Day 10 classifier fix.

### Decision 1: Strategic vs Interim target table

CalPERS CAFR contains both Strategic Asset Allocation (p.60, long-term board-adopted) and Interim Policy Target (p.126, in-effect during transition) tables. Both are legitimate GASB disclosures. Other plans may have similar distinctions.

Options:
- A: Always extract Strategic (aligns with IPS)
- B: Always extract Interim (captures in-effect today)
- C: Extract both with explicit table_basis column

Resolution required before Day 10 prompt fix.

### Decision 2: document_type='cafr' taxonomy

Day 9 cleanup investigation revealed document_type='cafr' is being used as a catchall across 20 plans. Of 16+ documents tagged 'cafr':
- ~4-5 are actual CAFRs
- ~7 are annual reports (different from CAFR)
- 2 are quarterly investment reports
- 1 is a Popular Annual Financial Report (summary)
- 2 are board agenda items
- 1 is "fund insights" document

All tagged the same. CHECK constraint allows finer types (annual_report, performance_report, agenda_packet) but scrapers underuse them.

Implications:
- Cross-source verification semantics partially invalid when "CAFR allocation" actually means "annual or quarterly disclosure"
- Some of the 178 CAFR-derived allocations come from point-in-time snapshots (quarterly), not policy targets
- Document audit needed to know what fraction of existing extractions are policy targets vs other things

Resolution options:
- A: Re-tag misclassified docs, audit each existing allocation against source
- B: Add document_subtype column for finer typology, keep existing tags
- C: Accept current taxonomy, document the noise

### Compounded scope

Decision 2 affects Decision 1: if we don't know which documents are real CAFRs, we don't know which extractions represent the Strategic-vs-Interim distinction at all. Quarterly reports don't have Strategic/Interim - they have current actuals.

Day 10 will likely begin with audit work to scope the decision rather than directly implementing a prompt fix.
