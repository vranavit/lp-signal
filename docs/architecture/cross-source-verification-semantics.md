# Cross-source verification semantics

Status: living document. Last updated 2026-04-30 (Day 6 of Week 1 sprint).

## What this document is

A specification of what "verifying" two records means for each pairing of record types in the Allocus signal model. Originally written after the Day 5 v1.0 verifier shipped with a generic "are these the same event?" prompt and produced semantically meaningless conflict signals. The Day 6 v1.1 fix rewrites the prompt for the allocation-allocation pairing only and pre-filters pairs by temporal logic. Future pairings (signal-signal, consultant-consultant, allocation-pacing, etc.) will follow the same structure: define what "same" means before writing the prompt.

## Original framing (Day 5 v1.0, deprecated)

`verifyCrossSource(recordA, recordB)` returned `{verification_type, confidence, rationale}` where `verification_type` was one of `confirms` / `partially_confirms` / `conflicts` / `unrelated`. The prompt asked the model: "Are these records describing the same plan's official policy on the same asset class for an overlapping time period?"

The function had cheap pre-checks for plan_id and asset_class, but no temporal pre-filter. Any pair with the same plan and asset class went to the model, and the model was expected to handle date logic implicitly.

## Day 5 finding: the framing was wrong

Day 5 ran the verifier on 48 (CAFR, IPS) pairs across CalPERS, CalSTRS, and Oregon. The result distribution was 18 confirms / 7 partially_confirms / 9 conflicts / 14 unrelated. The 9 conflicts were investigated pre-Day-6 and categorized:

- 7 of 9 were time-period artifacts: CalSTRS CAFRs from FY2023 (June 2023) compared against the IPS adopted Jan 2024. The values legitimately differed because the policy was different in those generations.
- 1 of 9 was a real data quality issue: CalPERS Credit IPS at 8% vs CAFR at 3.5%, where the CAFR extraction had likely captured a Private Debt sub-sleeve and labeled it the Credit parent.
- 1 of 9 was a mixed case (range narrowed but target unchanged).

The verifier was conflating two different questions:

1. "Is the underlying policy the same?" (semantically: are these records describing the same plan + asset class)
2. "Did the policy change between record A's time and record B's time?" (semantically: at the policy level, did the targets shift)

These are different questions. Asking them together produced verdicts that mixed real data quality issues with normal policy evolution.

## Day 6 v1.1 resolution: pre-filter, then model

Two changes:

### 1. Temporal pre-filter (`buildVerifiablePairs`)

For each CAFR row, the function finds the IPS that was in force at the CAFR's fiscal year end. "In force" means: the most recent IPS row for the same (plan_id, asset_class, sub_class) whose `as_of_date` is at or before the CAFR's `as_of_date`. CAFR rows that predate every IPS we have for that asset class are dropped silently. Sub_class mismatches between the two records (both non-null and different) are also dropped.

The effect: only pairs where the IPS could plausibly be the policy in effect at the CAFR's date are sent to the model. Pre-IPS-adoption snapshots no longer reach the verifier.

In the Day 6 dataset, 48 brute-force compatible pairs reduced to 29 verifier-eligible pairs (11 dropped by sub_class pre-filter, 8 dropped by temporal filter).

### 2. `policy_changed` verdict

Even within an IPS adoption window, plans can revise targets mid-cycle (between IPS adoption and the next CAFR). The v1.1 prompt distinguishes:

- `confirms` - values agree within 0.5pp
- `partially_confirms` - hierarchy mismatch (parent vs sub-sleeve)
- `policy_changed` - same plan, same asset class, both records valid, value differs by 1 to 4pp due to mid-cycle revision (NOT a conflict)
- `conflicts` - values differ by 3+ pp, no hierarchy or revision explanation, suggests extraction error or genuine data quality issue
- `unrelated` - structurally separate sleeves (now mostly pre-filtered out)

`conflicts` is now reserved for genuine data quality flags. In the Day 6 re-run, 29 verified pairs produced 2 conflicts: 1 real (CalPERS Credit, the pre-identified mis-aggregation) and 1 false positive (CalPERS Public Equity / Cap Weighted misread by the model as parent-level rather than sub-sleeve).

## Allocation-allocation eligibility filters

Before invoking the LLM verifier, allocation pairs are filtered by two structural rules:

### 1. Temporal eligibility

Pairs are only retained when they describe the same policy generation. The CAFR's `as_of_date` must fall within the IPS's adoption window (defined as: from the IPS's effective date until the next IPS's effective date, or until present if no later IPS exists).

Implementation: `buildVerifiablePairs()` in `lib/predictive/verify-cross-source.ts` handles this filter.

Cross-generation pairs (e.g., CAFR FY2023 vs IPS effective 2024-01-01) are dropped. They describe different policies and cannot be meaningfully verified.

### 2. Sub_class structural eligibility

Pairs are dropped when both records have non-null `sub_class` AND the `sub_class` values differ. Such pairs describe different sleeves within the same parent asset class and would deterministically receive an `unrelated` verdict under v1.0.

Pairs that ARE retained:
- Both null `sub_class` (parent-parent comparison)
- One null + one non-null (parent vs sub-sleeve, candidate for `partially_confirms`)
- Both non-null with same `sub_class` string (sub-sleeve confirms candidate)

Caveats:
- Assumes `sub_class` labels are canonically normalized across plans. If two plans use functionally equivalent labels with different strings (e.g., "MBS" vs "Mortgage-Backed Securities"), the filter would drop them silently. No such case exists in the current 3-plan dataset.
- Loses explicit `unrelated` audit trail for pre-filtered pairs. A future query of "how many pairs evaluated as unrelated" would undercount the structurally-impossible cases.

TODO: When the dataset expands beyond 3 plans, evaluate a `sub_class` normalization layer. May need a canonical `sub_class` taxonomy maintained alongside the `asset_class` enum.

### `same_event` field

The `VerificationResult.same_event` boolean is true when the verdict is `confirms`, `partially_confirms`, or `policy_changed`. It is false for `conflicts` and `unrelated`. Downstream signal weighting should treat `same_event=true` as "these records describe one plan-policy fact" and weight accordingly.

## The general framework

For any pairing of record types (X, Y), we define:

1. **Eligibility filter.** A function on the structural fields of X and Y that returns the set of pairs that are even candidates for verification. Eliminates obviously-wrong pairings before model time.

2. **Temporal alignment rule.** For X and Y that capture state at different points in time, what alignment is required? Examples:
   - CAFR / IPS: CAFR's fiscal year end must fall in IPS's adoption window
   - Press release / board minute commitment: both must reference the same approval action, typically within 90 days
   - Pacing plan / actual deployment: pacing plan must be in force at the deployment date
   - Consultant relationship A / consultant relationship B: must overlap in time

3. **Verdict vocabulary.** What outcomes can the verifier produce? Should match the actual semantics of comparing X and Y. Allocation-allocation needs `policy_changed`; signal-signal will need something like `superseded` (one signal is a corrected version of the other); consultant-consultant will need `same_relationship` vs `succession` (same firm, different person, role transferred).

4. **Confidence weighting hook.** How do verdicts feed into the predictive engine's signal weight? `confirms` adds the most weight; `partially_confirms` and `policy_changed` add some; `conflicts` flags for review; `unrelated` does nothing. The exact numbers depend on signal type.

The Day 5 mistake was implementing step 4 (the function) before steps 1, 2, and 3 (the semantics).

## Pairings to design before implementing

These pairings will appear in Weeks 2-4. Each requires a separate semantic spec before code is written.

### signal-signal (commitment cross-source)

Two signals describing the same GP commitment from different document streams. Press release announces "Board approved $500M to KKR Infra V"; board minutes confirm "Adopted: KKR Infra Fund V, $500M". Same event, different streams.

Eligibility filter: same plan, same GP (probably matched on a normalized GP key), commitment amount within 5% (allow for rounding in the press release).

Temporal alignment: both signals dated within 90 days of each other (press releases sometimes precede board approval by 30-60 days; board minute publication can lag the meeting by 30-90 days).

Verdict vocabulary: `confirms` (same commitment), `superseded` (board minutes show revised amount or split commitment), `unrelated` (different commitments to same GP), `conflicts` (amount diverges materially with no explanation).

### consultant-consultant (de-dup canonicalization)

Two consultant relationships extracted from different documents. Need to determine whether they describe the same firm (just different name spellings: "Meketa" vs "Meketa Investment Group" vs "Meketa Investment Group, Inc.") or different firms.

Eligibility filter: same plan (consultants are plan-specific in our model).

Temporal alignment: overlapping engagement periods.

Verdict vocabulary: `same_consultant` (same firm, possibly different name forms), `succession` (firm A succeeded by firm B at the same plan), `unrelated` (genuinely different firms), `conflicts` (extraction error - one record names the wrong firm).

### allocation-pacing (consistency check)

Allocation policy says target is 17% PE; pacing plan says deploy $3.2B/year. Are these consistent given AUM and current actual?

Eligibility filter: same plan, same asset class, pacing plan dated within IPS adoption window.

Temporal alignment: pacing plan in force when allocation row was captured.

Verdict vocabulary: `consistent` (math works out), `aggressive_pacing` (pacing implies overshooting target), `slow_pacing` (pacing implies missing target by year N), `cannot_compute` (missing AUM or current actual data).

This pairing is more interesting because it can produce predictive signals: aggressive pacing predicts target revision upward; slow pacing predicts continued under-allocation.

## Pattern for future verification work

1. Write the semantic spec in this document first.
2. Define the eligibility filter as a typed helper function (analog of `buildVerifiablePairs`).
3. Define the verdict vocabulary as a TypeScript union type and as a CHECK constraint on `source_verifications.verification_type`.
4. Write the prompt last, with explicit calibration rules that reference the eligibility filter and verdict definitions.
5. Smoke-test against a small known set before turning on automated verification.
6. Document the calibration in the source_verifications schema or a sibling table so downstream confidence weighting can compose verdicts across pairing types.

## Known scaling concerns

### Polymorphic source_verifications associations

`source_verifications.record_a_id` and `record_a_type` (similarly `record_b_id`, `record_b_type`) are polymorphic - they point to rows in `pension_allocations`, `signals`, or `consultants` tables based on the type field. This means no PostgreSQL foreign key constraint, and queries must do two `.in()` calls + app-level merge.

At Day 8 scale (29 verifications), this is fine. At 1000+ verifications, the dual-query pattern becomes a performance concern.

Mitigation when scale demands: add denormalized columns (`plan_id`, `asset_class`) directly on `source_verifications` for the common allocation-allocation case. Other pairings retain polymorphic lookup.

Not blocking; revisit when verification volume passes ~500 rows or when query latency on related-signal lookup exceeds 100ms.

## Open questions

- **Confidence weighting math.** Spec Section 5e says single-source = 1.0, 2-source confirmation = 1.5, 3-source = 2.0. Should `policy_changed` count toward the multi-source weight? Probably yes, but the math needs spelling out before pipeline integration in Day 7.

- **Multi-IPS plans.** Plans that file IPS revisions yearly (rare, but exists) will have multiple in-force IPS windows. The current pre-filter handles this correctly (most recent IPS at-or-before CAFR date), but the verifier doesn't yet have access to "this is the second of three IPS revisions" context. Likely fine; revisit if a plan ingests multiple IPSes.

- **Signal-allocation pairings.** A T1 signal "CalPERS committed $200M to KKR Infra V" and an allocation row "CalPERS Infrastructure target 13%" describe related but different things. Should they ever be cross-verified? Probably not - the signal is an event, the allocation is a policy. They feed into the same predictive model but via different paths.

## Changelog

- 2026-04-30 Day 5: v1.0 shipped with allocation-allocation only, generic "same event" framing.
- 2026-04-30 Day 6: v1.1 shipped with temporal pre-filter and `policy_changed` verdict. v1.0 rows cleared, v1.1 re-run produced 2 conflicts (1 real, 1 false positive) on 29 pairs.
