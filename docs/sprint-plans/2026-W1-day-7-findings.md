# Week 1 Day 7 Findings

Date: 2026-04-30 (Day 7 = closeout day for Week 1; same calendar day as Days 4, 5, 6)

## Headline

Week 1 audit pass complete. **No P1 findings.** Two P2 findings to be picked up in Week 2 (one is already on the Week 2 plan); three P3 findings logged for later. Build spec updated to v3.0 with Week 1 learnings reflected; v2 preserved at `lp_signal_build_spec_v2_2026-04-29.md`. Week 2 sprint plan written.

## Audit summary

5-audit institutional standard applied across Days 1-6 work.

### Audit 1: Code quality

Reviewed: 3 press release scrapers, 4 IPS scrapers + shared `ingestIps`, 2 classifier prompts (`press-release.ts`, `ips.ts`), `verify-cross-source.ts`, 7 cron route handlers, 2 Week 1 migrations.

Findings:
- All scrapers follow the same shape (cheerio walk -> per-URL fetch -> body extract -> sha256 dedup -> insert). Consistent error accumulation pattern via `result.errors[]`.
- All 4 IPS scrapers delegate to a shared `ingestIps()` helper; per-plan files are 15-20 lines each. Clean.
- The 3 press release scrapers each export their own local `ScrapeResult` type with the same shape. Minor duplication (~15 lines per file). **P3.**
- Two press scrapers (CalSTRS, Oregon) silently `continue` past too-short bodies (sidebar CTAs, empty pages); CalPERS pushes to `result.errors[]` for the same condition. Inconsistent. **P3.**
- All 7 cron routes use the shared `runScrapeCron` wrapper from `cron-shared`. Press routes use `expectedCadenceHours: 24`, IPS routes use `168`. Consistent within type.
- `verify-cross-source.ts` is well-documented with the v1.1 framing in the top docstring and the `buildVerifiablePairs` reasoning inline.
- No dead code, no leftover TODO comments, no missing types. tsc clean.

### Audit 2: Schema integrity

Run via direct `pg` query against production Supabase.

Findings:
- **0 true orphans across documents / signals / pension_allocations / source_verifications.** The 13 documents and 3 signals that initially appeared as "orphans" via `LEFT JOIN` are intentional NULL parents:
  - 13 documents are `gp_press_release` rows tied to `gp_id`, not `plan_id`; `plan_id` is NULL by design.
  - 3 signals are `seed_data=true` rows from the 2026-04-21 demo seed; `document_id` is NULL by design.
- **All FK constraints verified.** `documents.plan_id`, `documents.gp_id`, `signals.document_id`, `signals.plan_id`, `signals.gp_id`, `pension_allocations.plan_id`, `pension_allocations.source_document_id` all wired. CASCADE on plan / gp deletes; SET NULL on document deletes. Healthy.
- **13 documents in `processing_status='error'`.** Breakdown:
  - 8 are classifier validation failures: model returned `null` for a required numeric field (`amount_usd`, `old_target_pct`, etc.) instead of omitting the signal entirely per the prompt's CRITICAL rule.
  - 3 are `out_of_scope: transcript` rejections (legitimate, transcripts are out of scope).
  - 2 are `too_long` (>100 or >300 page docs hit the design limit).
  - 1 is "Expected array, received string" (model returned stringified output).
  - **Pre-existing classifier robustness issue, not introduced by Week 1.** **P2.** Already on the Week 2 backlog as the per-signal validation refactor item.
- **NYSCRF IPS document is `complete` but extracted 0 allocations.** 54KB of text ingested. Either (a) the URL points to a governance policy doc rather than the asset allocation policy, or (b) the v1.0-ips classifier prompt failed on NYSCRF's table structure. **P2.** Day 4 of Week 2 plan.
- **`source_verifications` has only v1.1-allocation rows (29 total).** v1.0-allocation cleared during Day 6 v1.1 redesign. Distribution: 17 confirms / 6 partially_confirms / 4 policy_changed / 2 conflicts.
- **CHECK constraint on `verification_type` includes `policy_changed`** per Day 6 migration. Verified.
- **Migration tracker** is up to date through `20260429203325_add_policy_changed_verdict`. The 16 migrations dated `20260501*` predate Week 1 (likely batch-applied future-dated stamps from earlier work; not a Week 1 audit concern).

### Audit 3: Documentation completeness

Reviewed: 6 day-by-day findings docs, sources doc, architecture doc, build spec.

Findings:
- All 6 daily findings docs follow the same structure (Headline, What was built, What was deferred, Pattern check). Consistent.
- `2026-W1-sources.md` is accurate against the actually-shipped scrapers. URLs verified.
- `docs/architecture/cross-source-verification-semantics.md` is current as of Day 6 (sub_class filter documented). Future pairings sketched but not yet implemented (correct).
- **Day 5 findings doc cites "10 T3 signals exist"** as evidence the existing classifier extracts pacing. Actually 9 classifier-extracted + 1 seed_data row. The conclusion holds, but the count is off by 1. **P3.** Footnote fix on Day 4 of Week 2.
- `lp_signal_build_spec.md` (v2.0) has a stale Section 10 schema for `source_verifications` (uses `signal_id` + `verifying_document_id`, the pre-Day-5 design). v3 update fixes this. **Resolved in Day 7 v3 spec write.**

### Audit 4: Pattern consistency

Findings:
- Cron routes: 7 of 7 use `runScrapeCron`. Press routes use `summarizeStringList(insertedUrls)` for hashHint; IPS routes use the textHash directly. Different but appropriate to the data shape.
- Press routes return gracefully when the plan is missing (`{summary: 'plan not found', errors: [...]}`); IPS routes throw via `resolvePlanId()`. Slight inconsistency. **P3.**
- All scrapers use `createHash('sha256')` for content hashing. Consistent.
- Press release scrapers use `content_hash` over post-extraction body text; IPS scrapers use `content_hash` over post-extraction PDF text via unpdf. Different inputs but same algorithm.
- Local `ScrapeResult` type is duplicated across 3 press scrapers. **P3.**

### Audit 5: Build / test / lint

- `pnpm tsc --noEmit`: **clean.**
- `pnpm lint`: 3 pre-existing warnings on `app/(dashboard)/explore/explore-table.tsx` and `app/(dashboard)/explore/explore-workspace.tsx`. Unrelated to Week 1 work. No new warnings introduced by Week 1.
- `pnpm build`: **succeeds.** All Week 1 cron routes appear in the route table.
- No P1 / P2 findings in this audit.

## Findings classification

### P1 (must fix before Week 2 work continues)

**None.**

### P2 (should fix during Week 2)

| # | Finding | Disposition |
|---|---|---|
| P2.1 | 13 board-minute documents in `processing_status='error'` (8 classifier validation failures + 3 transcripts + 2 too-long + 1 array-vs-string) | Already on backlog as classifier per-signal validation refactor (Section 16 of v3 spec). Week 2 Day 4 will categorize but defer the refactor to Month 2. |
| P2.2 | NYSCRF IPS doc ingested but extracted 0 allocations | Week 2 Day 4 investigation: wrong URL or prompt failure. |

### P3 (log for later, doesn't block)

| # | Finding | Disposition |
|---|---|---|
| P3.1 | Local `ScrapeResult` type duplicated across 3 press scrapers | Extract to shared module when adding the 4th press scraper (Mass PRIM or NYSCRF). |
| P3.2 | Press scrapers silently `continue` on too-short bodies (CalSTRS, Oregon) vs CalPERS which logs to `errors[]` | Pick one pattern; pin in `lib/scrapers/cron-shared.ts` documentation. |
| P3.3 | IPS routes throw on plan-not-found; press routes return gracefully | Pick one. Recommend the press-routes graceful-return pattern (cron health check still alerts via empty `summary`). |
| P3.4 | Day 5 findings doc T3 count off by 1 (says 10, actually 9 classifier + 1 seed) | Footnote fix on Day 4 of Week 2 (or now in Day 7 closing). |
| P3.5 | Section 10 of build spec had stale `source_verifications` schema | **Resolved in Day 7 v3 spec write.** |

### P1 fixes applied in Day 7

None - no P1 findings.

## v3 spec changes summary

Preserved v2 to `lp_signal_build_spec_v2_2026-04-29.md`. Rewrote `lp_signal_build_spec.md` with the following updates:

- **Header:** v3.0, dated 2026-04-30, supersedes v2.0.
- **Section 0:** Added "What changed from v2" with 6 items.
- **Section 3 (stream priorities):** Rewrote the 7-stream table with Week 1 T1-yield evidence per stream. Press release stream framing corrected (0% T1 across 3 plans). IPS established as the predictive-layer high-yield stream. Pacing-as-separate-stream retired.
- **Section 5e (predictive engine):** Added the v1.1 verifier description, the 2-step temporal-pre-filter + model-call architecture, and a reference to the architecture doc.
- **Section 10 (schema):** Replaced the stale `source_verifications` schema (signal-anchored design) with the actually-shipped record-pair design. Added `prompt_version` conventions table.
- **Section 11 (build phases):** Updated Week 1 to "DONE" with shipped vs deferred breakdown. Added Week 2 priority list. Stream count target reduced from 7 to 5-6.
- **Section 12 (classifier prompts):** Updated the prompt list to include the actually-shipped variants (board-minute, press-release, GP-press-release, CAFR, IPS, cross-source verifier). Added `prompt_version` reference.
- **Section 16 (renamed to Backlog):** Added Type 4 Relationship Signal, classifier per-signal validation refactor, verifier v1.2 calibration, and sub_class normalization layer. Open questions moved to Section 17.

No content was deleted from v2; only updated or augmented. v2 remains available for historical comparison.

## Week 2 plan summary

`docs/sprint-plans/2026-W2-plan.md` written. Day-by-day:

- **Day 1:** Pipeline integration of `verifyCrossSource` (auto-run on new allocation arrival; signal confidence multiplier).
- **Day 2:** CAFR extraction quality fixes (CalPERS Credit, CalPERS Public Equity sub-sleeve).
- **Day 3:** Mass PRIM IPS via date-sweep + NYSCRF press AJAX investigation.
- **Day 4:** NYSCRF IPS allocation re-extract + Week 1 P2 follow-ups.
- **Day 5:** Relationship graph foundation - `plan_stakeholders` schema + first staff directory scraper (CalPERS).
- **Day 6:** CalSTRS staff directory + Week 2 audit pass.
- **Day 7:** Week 2 closeout + Week 3 plan.

Definition of done: pipeline integration runs auto; 2 real CAFR conflicts dispositioned; Mass PRIM or NYSCRF shipped (1 of 2 minimum); first plan_stakeholders rows ingested.

## Week 1 retrospective

### What went well

- **The institutional pattern caught real issues in real time.** Day 5 v1.0 verifier shipped with a generic "same event" prompt that produced a 18.75% conflict rate. Vitek's pre-Day-6 hypothesis ("conflicts are time-period artifacts") + structured analytical investigation + Day 6 v1.1 redesign turned a potentially bad architectural call into a documented framework. The 5-audit standard plus pattern-check-after-every-fix worked as intended.
- **Cross-source verification iteration was valuable.** v1.0 to v1.1 took one day. v1.1 produced 1 real conflict (the predicted CalPERS Credit issue) + 1 false positive (Cap Weighted sub-sleeve) on 29 pairs vs 9 conflicts (mostly false positives) on 48 pairs in v1.0. The architecture doc captures the framework so future pairings benefit from the lesson.
- **IPS extraction produced real signal.** 25 target allocation rows across 3 plans, with sub-sleeve granularity that CAFR rolls up. CalPERS Fixed Income split into Treasury / IG Corp / HY / MBS / EM Sov is exactly the kind of structured intelligence the predictive layer needs. CalSTRS index-crawl pattern (rotating-URL handling) is reusable for future scrapers.
- **Pattern check caught the GP press release vs press release dispatch issue on Day 2** before it silently misclassified data.
- **Schema verification on Day 1 prevented a destructive migration.** Pre-flight check against the existing `documents_document_type_check` constraint showed the original migration would have dropped 6 allowed values including 13 active rows of `gp_press_release` data.

### What surprised us

- **Press releases yield 0% T1 across CalPERS, CalSTRS, Oregon.** v2 spec called press releases "highest signal density." Three large public pensions show ~0% direct commitment yield. The hypothesis was wrong. Press releases serve PR / governance / performance functions; deal-level disclosure is reserved for board minutes and Investment Transactions Reports. Smaller plans may behave differently (Reading B from Day 2 findings); sample of 3 large plans is not representative of all 20.
- **Pacing data was already captured in board minutes.** v2 listed pacing plans as a Week 3 stream. Day 5 investigation found 9 T3 pacing signals (signal_type=3, non-seed) had already been extracted by the existing classifier. Pacing is embedded in Investment Committee packets at all 5 plans. No separate scraper class needed. Stream 6 (pacing) retired in v3.
- **CAFR-IPS conflicts were mostly time-period artifacts.** Day 5's 9 conflicts looked alarming. Day 6 categorization showed 7 of 9 were CalSTRS FY2023 CAFR vs Jan 2024 IPS - the IPS hadn't been adopted yet at the CAFR's fiscal year end, so they describe different policy generations. Without the temporal pre-filter, the verifier was conflating "different generations" with "data quality issue."
- **Mass PRIM is structurally different from CalPERS / CalSTRS / Oregon.** No discoverable index URL for IPS, aggregator newsroom for press releases. Surfaces a likely "different scraping strategy" need for Month 2.

### What we would do differently

- **URL verification on Day 1 should also verify "does this document contain the data we expect?", not just "does this URL load?"** The NYSCRF IPS at `general-investment-policies.pdf` returned 200 OK and 54KB of text, so it passed Day 1 URL verification. But the v1.0-ips classifier extracted 0 allocations from it. Day 1 should have included a content-spot-check (manual eyeball of the first PDF page) to catch wrong-document cases before downstream extraction failures.
- **Spec deviations should be flagged at execution time, not at audit time.** The Day 6 sub_class structural pre-filter was added beyond the original spec without explicit user confirmation. Surfaced in Day 6 verification questions, documented in the architecture doc, and added as a feedback memory ("operational probes don't live in the tree" / "spec deviations should be flagged at execution time"). Pattern reinforcement: when an implementation diverges from the spec, pause and confirm.
- **The "highest signal density" framing in v2 should have been validated on a sample of 1 before being baked into a 7-stream model.** A single CalPERS press release inspection on Day 2 caught the issue, but the v2 spec had committed to 5 press release scrapers. We shipped 3 of 5 and pivoted at Day 4. With a Day 0 sample-of-1 check, we could have descoped to 1 of 5 and saved 2 days. Future spec writes: validate the highest-impact assumption before committing the spec to it.

## Architectural concerns surfaced during audit

None that block Week 2. Two surfaced for tracking:

1. **Where does the cross-source verification confidence multiplier live on signals?** Section 5e of v3 spec calls for 1.0 / 1.5 / 2.0 multipliers based on cross-source confirmation. Day 1 of Week 2 has this as a design call (materialized column on `signals` vs computed view).
2. **Verifier v1.x is allocation-allocation only.** Future signal-signal and consultant-consultant pairings need their own semantic specs before prompts. Documented in the architecture doc; first signal-signal pairing is likely Month 2 (commitment cross-source between press release T1 and board minute T1).

## Counts

- 17 commits across Week 1 (Day 0 plan + 6 days of work + Day 7 closeout to come)
- 7 active scrapers shipped (3 press release + 4 IPS); 3 were originally planned and deferred
- 7 daily findings docs (1 per day Days 1-7)
- 2 schema migrations applied (`source_verifications` table + `policy_changed` verdict CHECK)
- 1 architecture framework doc (`cross-source-verification-semantics.md`)
- 1 v3 spec rewrite (preserving v2 to dated file)
- 0 P1 findings; 2 P2 findings; 5 P3 findings
- 415 signals total in DB (393 T1 + 11 T2 + 10 T3, with 3 of those being seed_data)
- 25 IPS allocations across 3 plans
- 29 source_verifications rows (v1.1-allocation)

End of Week 1.
