# Week 1 Day 5 Findings

Date: 2026-04-30 (continuing same calendar day as Day 4 - multi-phase build session)

## Headline

Day 5 pivoted from pacing plan scrapers to the cross-source verification primitive (originally Day 7). Pacing investigation showed 0 of 5 plans publish pacing as a separate document, and the existing classifier is already extracting pacing signals from board minutes (10 T3 signals exist on 2026-04-30). Verification primitive shipped with 48 allocation pairs verified, distribution within calibration thresholds, and three pre-identified data quality findings confirmed.

## Phase 1A: Pacing plan investigation

Inspected the 5 Week-1 plans to determine whether pacing plans are published as separate documents:

| Plan | Pacing as standalone doc? | Where pacing data lives |
|---|---|---|
| CalPERS | No | PE program pacing in Investment Committee packets (board minutes) |
| CalSTRS | No | PE/Co-Investment pacing in Investment Committee packets |
| NYSCRF | No | Discussed in Common Retirement Fund Investment Reports (board minutes) |
| Mass PRIM | No | Discussed in Investment Committee minutes |
| Oregon PERS (OIC) | No | OPERF asset class pacing in OIC Investment Committee packets (board minutes) |

Conclusion: pacing is an embedded section of board minutes / Investment Committee packets, not a separate document type. No new scraper class is needed.

Verified the existing signal classifier is already extracting pacing data: 10 T3 (Type 3) signals exist as of 2026-04-30, all `signal_type=3`, all pacing-related, across CalPERS / CalSTRS / SMRS / OPERF. Examples:

- "CalPERS 2026 private equity pacing increased to $14B (from $12B in 2025)"
- "CalSTRS PE program sets 2026 pacing targets of $9 billion total ($6B fund investments + $3B co-investments)"
- "OPERF Real Estate lowered its 2025 annual commitment pacing to ~$500M from $520M committed in 2024"
- "OPERF PE 2026 commitment pacing is planned at the lower end of the $2.5B-$3.5B historical range"

The existing classifier handles pacing extraction from board minutes correctly. The "build pacing scrapers" item from the original Week 1 plan was redundant work.

## Phase 1B: Day 5 pivot decision

Three options considered:

1. Build asset-class committee minute scrapers (Spec Section 11 Week 3 work). Skipped because Phase 1A already validated pacing extraction from existing minutes; building more minute scrapers would not add new signal types yet.
2. Move on to Week 2 plans early. Skipped because Day 5 budget (5-6 hours) was already allocated and Week 2 has its own setup work.
3. Pull cross-source verification primitive forward from Day 7. Selected because we now have 25 IPS-derived allocation rows + the existing CAFR allocation rows for the same plans. Allocation-allocation pairing is the cleanest cross-source test we can run today.

## Phase 2-4: Cross-source verification primitive

### What was built

- `lib/predictive/verify-cross-source.ts` - implements `verifyCrossSource(recordA, recordB)` per spec Section 5e. Returns `{verification_type, confidence, rationale}` with verification types `confirms` / `partially_confirms` / `conflicts` / `unrelated`. Cheap pre-checks on `plan_id` and `asset_class` short-circuit obvious mismatches before the API call. Uses `record_verification` tool-use schema for structured output.
- `persistVerification` helper in the same file - upsert into `source_verifications` keyed on the canonical-ordered pair index. Idempotent.
- New table `source_verifications` per spec Section 10. Migration `20260429192753_add_source_verifications.sql`. Unique pair index uses `least()` / `greatest()` so re-running on the same pair (in either order) updates rather than duplicates.

### Verification results

48 pairs tested across the 3 plans with both CAFR and IPS allocations.

| Plan | Pairs | Notes |
|---|---|---|
| CalSTRS | 30 | Largest because CalSTRS has CAFR rows from FY2023, FY2024, FY2025 + IPS dated 2024-01-01 |
| CalPERS | 10 | CalPERS IPS includes 5 Fixed Income sub-sleeves split out from the CAFR rollup |
| Oregon PERS | 8 | Smaller IPS extraction (6 rows) limits pair count |

Distribution:

| Verification type | Count | Share | Mean confidence |
|---|---|---|---|
| confirms | 18 | 37.5% | 0.94 |
| partially_confirms | 7 | 14.6% | 0.76 |
| conflicts | 9 | 18.8% | 0.82 |
| unrelated | 14 | 29.2% | 0.87 |

The 14 `unrelated` verdicts came from the API (not the cheap pre-check), correctly identifying sub_class mismatches within the same parent asset class. Example: CalPERS Fixed Income at the parent level vs. CalPERS Fixed Income / Treasury at the sub_class level. The pre-check passed both rows because the parent asset_class string matched, and the model correctly drew the line.

Of the 34 verifiable pairs (excluding `unrelated`), 53% confirmed, 21% partially confirmed, 26% conflicted.

### Calibration check

Per spec the thresholds are:
- conflicts > 20% means prompt is too aggressive (false positives)
- confirms > 95% means prompt is too lenient (false negatives)

Result: 9/48 = 18.8% conflicts (just below threshold). 18/48 = 37.5% confirms (well below 95%). Both reasonable. No re-calibration needed.

### Data quality findings confirmed

All three pre-identified data quality findings were correctly flagged as `conflicts`:

| Plan | Asset class | IPS | CAFR | Verifier verdict |
|---|---|---|---|---|
| CalPERS | Credit | 8% | 3.5% | conflicts @ 0.78 - "4.5 percentage point gap that exceeds the 3pp conflict threshold" |
| CalSTRS | Public Equity | 38% | 42% | conflicts @ 0.82 - "4 percentage point gap... too large to attribute to rounding or sub-sleeve roll-up" |
| CalSTRS | Fixed Income | 14% | 13% | conflicts @ 0.82 - "the policy ranges differ by a full percentage point on both ends and are mutually inconsistent" |

The verifier independently surfaced additional conflicts on CalSTRS Public Equity, Fixed Income, PE, and Risk Mitigating Strategies across the 2023, 2024, 2025 CAFRs vs. the 2024-01-01 IPS. The pattern is consistent: the IPS captures policy ranges adopted Jan 2024, while older CAFRs reflect pre-2024 ranges. The verifier interprets the range shifts as policy generations rather than rounding.

### Sample partially_confirms verdicts

The `partially_confirms` cases are dominated by CalPERS Fixed Income, where the CAFR rolls up the parent class (29.1%) and the IPS splits the sub-sleeves (Treasury 7%, IG Corp 6%, HY 5%, MBS 5%, EM Sov 5%). The verifier consistently rationalizes these as "classic roll-up vs. sub-sleeve split" rather than conflicts. This is the expected behavior for a verifier that needs to tolerate granularity differences between source types.

One CalSTRS Real Estate case is `partially_confirms` because the targets match (15% / 15%) but the ranges differ (CAFR ±3% vs IPS ±5%). The verifier interprets the range difference as either a policy update or a CAFR-vs-IPS narrowness convention. Reasonable call.

## Architectural deferral

Day 5 scope was the function plus a manual batch test. The function is pure (no DB writes) so the caller decides when to persist via `persistVerification`. Wiring this into the live ingestion pipeline (auto-run on new signal arrival, update confidence weights, fan out to find candidate matches) is deferred to Day 6/7.

Open questions for Day 6/7 pipeline integration:

1. When a new allocation row is inserted, what is the candidate-match strategy? Cheapest is "same plan + same asset_class within last 24 months". A broader strategy would also fan out to signals (Type 1 commitments) when those eventually become verifiable against allocations.
2. Confidence weighting: spec Section 5e says single-source = 1.0, 2-source confirmation = 1.5, 3-source = 2.0. Where does this weight live? On the signal row, on the allocation row, or in a derived view? Open design decision.
3. Cost cap: 48 pairs cost ~$0.10 in API calls (Sonnet 4.6 with tool use, ~600 input + ~250 output tokens per pair). Auto-running on every new signal would scale linearly with ingestion volume. Acceptable at current rates but worth a budget check before pipeline integration.

## Updated Week 1 status

Through Day 5 (calendar 2026-04-30):

- Press release scrapers: 3 of 5 shipped (CalPERS, CalSTRS, Oregon). Mass PRIM and NYSCRF deferred to Week 2 with documented reasons.
- IPS scrapers: 4 of 5 shipped (CalPERS, NYSCRF, Oregon, CalSTRS). Mass PRIM IPS deferred to Week 2 (no discoverable index URL).
- Cross-source verification primitive: shipped (Day 5, pulled from Day 7). Allocation-allocation only; signal-signal and consultant-consultant pairings remain Week-2-or-later.
- Pipeline integration: deferred to Day 6/7.

Week 1 success criteria from the original plan:
- "5 plans x 2 streams = 10 active scrapers" - tracking 7 of 10 with 3 documented deferrals. Acceptable per the original plan's "if mid-week scope is at risk, ship 3-of-5 well rather than 5-of-5 badly" guidance.
- "Cross-source verification function works for at least one test case" - shipped 48 verified pairs. Significantly exceeds the bar.

## Pattern check / institutional flags

- The cross-source primitive should not be limited to allocation pairs forever. Once Week 2 ingests more press release / board minute commitment signals, the same function can run on signal pairs by adding a signal-aware prompt branch. The current `AllocationRecord` type signature should be generalized at that point.
- The `unrelated` pre-check inside `verifyCrossSource` returned 0 of 14 unrelated verdicts in this batch (the test script pre-filtered before calling). The pre-check is still load-bearing because it exists to short-circuit the API call when the caller has not pre-filtered. Day 6/7 pipeline integration will exercise this path because the caller will not always pre-filter.
- The CalSTRS conflict pattern (multiple year-over-year CAFRs flagged as `conflicts` against a single IPS) suggests the prompt should have an awareness of "same plan, different policy generation" as a separate verdict. Currently that pattern is split between `conflicts` (when ranges shift materially) and `unrelated` (when dates are >24 months apart). Worth a v1.1 prompt iteration once we have more data, but not blocking.

## Day 6 priorities

Three reasonable directions, in priority order:

1. Pipeline integration of `verifyCrossSource` per Phase architectural deferral above. This is the highest leverage work because it converts a manual primitive into an always-on signal weighting mechanism.
2. NYSCRF AJAX-cracked press release scraper (Week 1 deferral from Day 3). Roughly 30-60 minutes of HTTP inspection plus the scraper build.
3. Generalize `verifyCrossSource` to handle signal-signal pairings so the press release vs board minute commitment cross-check (the canonical use case in the spec) becomes runnable.

Recommendation: Day 6 = pipeline integration. The primitive only earns its keep when it runs automatically.

## Time budget

Original Day 5 plan: pacing scrapers x 5 + audit. ~5-6 hours estimated.

Actual Day 5: pacing investigation (30 min) + cross-source verification primitive end-to-end (function + migration + manual batch + persisted results + findings doc). ~3 hours actual.

Net: 2-3 hours saved on Day 5 against the original plan. Saved time goes to Day 6 pipeline integration.
