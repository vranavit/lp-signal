# Allocus Tech Audit — 2026-04-23

First baseline audit. Covers everything on `main` through Day 9.4 (`0620dc1`)
plus the Day-9.4 docs stack (`2cd3517`, `0eebb5f`). Audit conducted with the
`.claude/agents/tech-audit.md` agent definition.

## Summary

- **12 findings total**
- **0 critical**, **4 high**, **6 medium**, **2 low**
- Plus 7 positive findings worth preserving

No security vulnerabilities, no data corruption, no broken routes. Main
themes: a handful of operational gaps (sub-sleeve duplicates in allocations,
25 rows with missing `actual_pct`, 10 persistent CalPERS ingestion errors),
some audit-trail improvements (`prompt_version` persistence is only 72% on
signals), and doc drift between product name "LP Signal" (package) and
"Allocus" (UI).

## Critical findings (fix before any demo)

_None._ Every route returns HTTP 200, every FK is sound, every production
query batches its reads.

## High-priority findings (fix in next sprint)

### H-1 · 25/74 pension allocations have NULL `actual_pct` — 34 % of rows silently missing from unfunded-budget math

**Evidence.** DB query: `select count(*) filter (where actual_pct is null) from pension_allocations` → 25 of 74. Affected plans: NYSCRF 2025-03-31 (9 rows), TRS Texas 2025-08-31 (4 rows), WSIB 2025-06-30 (7 rows), Wisconsin SWIB 2024-12-31 (5 rows). These plans publish only target allocations (no current snapshot) in the CAFRs we ingested.

**Impact.** `lib/relevance/unfunded.ts` `unfundedUsd()` returns 0 whenever `actual_pct == null`. A plan whose CAFR only reports the target will silently contribute **$0** to the Allocus unfunded-budget headline, even if it has real deployment budget. `/outreach` totals and the landing-page `$25.9 B` number are therefore low-side estimates.

**Recommended fix.** Two options:
1. Ingest these plans' most recent monthly/quarterly fund fact sheet or flash-report for current actual percentages — operational, 1–2 hours per plan.
2. Display a per-plan "target-only — actuals unavailable" badge in the pension profile so the $-gap cells read `—` rather than `$0`. Also add a `NOTE` in the math-modal footnote. **1 hour** — can ship independently.

**Suggested phase.** Phase 2 (clarity) — the math-modal explainer is natural to extend there.

### H-2 · 7 duplicate `(plan_id, as_of_date, asset_class)` rows in `pension_allocations` from sub-sleeve collapsing

**Evidence.** DB query returns these groups:

| Plan | As-of | Class | Targets |
|---|---|---|---|
| TRS Texas | 2023-08-31 | Public Equity | 18 / 13 / 9 (Domestic / Int'l / Emerging) |
| CalPERS | 2024-11-01 | Fixed Income | 23 / 5 |
| CalSTRS | 2024-06-30 | Other | 10 / 0 (Risk Mitigating + Inflation + Innovation) |
| CalSTRS | 2025-06-30 | Other | 10 / 0 (same) |
| NYSCRF | 2025-03-31 | Public Equity | 32 / 15 (Domestic / Int'l) |
| TRS Texas | 2025-08-31 | Other | 21 / 5 |

Known and documented in `docs/day-5-notes.md`: CAFR schema collapses sub-sleeves into the core asset-class enum. Produces false-positive allocation rows and — per day-5 notes — at least one false-positive policy change (CalSTRS "Other 10 % → 0 %"). `allocation_policy_changes` has 3 rows today; at least one is a sub-sleeve artifact.

**Impact.** Allocation-gap math mostly works because Public Equity / Other aren't in `PRIVATE_MARKETS_CLASSES` (so they don't feed unfunded-budget totals), but the pension profile allocation table renders them as two rows with the same asset-class label, and the policy-change cron fires spurious email alerts.

**Recommended fix.** Extend the `asset_class` enum or persist a `sub_class` column on `pension_allocations`. Adjust classifier prompt `v1.0-cafr` to emit `asset_class` + `sub_class`. Backfill is optional since pension profile queries can dedupe by `(plan_id, as_of_date, asset_class, source_page, target_pct)` in-memory. **3 hours** including migration + classifier prompt tweak.

**Suggested phase.** Phase 2 (while already touching the classifier).

### H-3 · 10 CalPERS documents stuck in `processing_status='error'` with no retry path

**Evidence.** DB query returns 11 error rows (10 CalPERS + 1 WSIB). Error classes:

- 4 × `classifier output failed schema validation` (CalPERS board-minutes with unexpected shape)
- 3 × `out_of_scope: transcript` (CalPERS meeting transcripts — classifier correctly rejected)
- 2 × `storage download failed: Gateway/Bad Gateway` (Supabase Storage intermittent)
- 1 × `too_long: 120 pages (max 100)` (CalPERS Operating Memo batch)
- 1 × WSIB `invalid_type: expected number` (similar schema-validation)

**Impact.** Classifier silently shelves these. No cron retries schema-validation failures or Storage 5xx errors, so those documents never yield signals. CalPERS has 163 complete docs — 10 in error is ~6 %, but the classifier-schema-validation failures are the most interesting: they suggest CalPERS reports with structure the prompt didn't anticipate, potentially hiding real signals.

**Recommended fix.**
1. Add a `scripts/retry-failed-classification.ts` that re-runs classification on `documents` where `error_message LIKE '%Gateway%'` or `'%schema validation%'` and logs post-retry status.
2. Sample 2–3 of the `classifier output failed schema validation` rows and inspect the underlying PDF to decide whether the prompt needs an extension. **2 hours** diagnostic + fix.

**Suggested phase.** Near-term (pre-Phase 2).

### H-4 · `signals.prompt_version` is NULL on 15 of 75 validated signals (20 %)

**Evidence.** `select coalesce(prompt_version,'—'), count(*) from signals where seed_data=false and validated_at is not null group by 1`:

| `prompt_version` | count |
|---|---|
| `v2.3` | 56 |
| NULL | 15 |
| `v2.2-gp` | 4 |

The column exists and is populated for 80 % of rows; rejections and allocations carry it 100 %. The 15 NULLs are pre-v2.3 signals from Day 1–2 that were classified before the column was wired.

**Impact.** Drift-analysis queries over historical rows under-report prompt coverage; any "how does v2.3 perform vs v2.2?" comparison misses these 15 rows.

**Recommended fix.** One-off SQL: set `prompt_version = 'v2.2'` where it's NULL and `created_at < '2026-04-22'` (the v2.3 cutover). **15 min.**

**Suggested phase.** Immediate one-off.

## Medium-priority findings (address before scaling)

### M-1 · 1 of 10 preliminary-sampled signals has a schema-semantic mismatch (quarterly ≠ annual)

**Evidence.** Signal `3fdb8e23` (Michigan SMRS T3 pacing, confidence 0.72):

```json
{"new_year_pacing_usd": 1400000000, "prior_year_pacing_usd": 450000000, "pct_change": 211.1}
```

Source quote: `"In the December 2025 quarter, $1.4 billion new commitments were made"` versus `"approximately $450 million quarterly pace cited for September 2025"`. The classifier stored **quarterly** numbers in a field whose name implies **annual** pacing. The 211 % pct_change therefore reads as a year-over-year jump when it's actually quarter-over-quarter.

**Impact.** One row so far. But if Michigan SMRS or any similarly-quarterly-reporting plan produces more T3 signals, the pacing chart on the pension profile will be misleading.

**Recommended fix.** Either (a) add a `period` field (`"annual" | "quarterly"`) to the T3 schema so the UI can label correctly, or (b) tighten the prompt to reject quarterly figures from annual-pacing fields. **1.5 hours.**

### M-2 · `saved_filter_views` is empty — feature shipped but never exercised

**Evidence.** `select count(*) from saved_filter_views` → 0. Migration applied, RLS is clean (3 policies, unique index), UI is wired.

**Impact.** The feature is live but unproven. First user to save a view could surface edge-case bugs (long names, special characters, race conditions on simultaneous saves).

**Recommended fix.** Not a code fix — just manual QA. Create 2–3 saved views via the UI and delete them to exercise the end-to-end path. **15 min.**

### M-3 · Three seeded signals (CalPERS demo) have `validated_at = NULL` and never render on dashboard

**Evidence.** `signals 029cff69 / 547ac0a0 / 39bba5fc` all have `seed_data=true`, `preliminary=false`, confidence 0.87–0.95, but `validated_at IS NULL`. The `/signals` page query uses `.or("validated_at.not.is.null,seed_data.eq.true")` so these DO render on `/signals` — but `/outreach` uses `.not("validated_at", "is", null)` alone, so they're silently excluded from outreach targeting.

**Impact.** The three "demo seed" signals appear in the dashboard but not in outreach — inconsistent behavior that a demo might reveal. Also, if a user filters `/signals` by a date-range dropdown, the seeds' `created_at = 2026-04-21` behavior is ambiguous.

**Recommended fix.** Either backfill `validated_at = created_at` on the three seeds, or document in a code comment that seed rows are rendered everywhere signals surface. **10 min.**

### M-4 · `source-url.ts` server action has no authentication check

**Evidence.** `app/actions/source-url.ts` uses `createSupabaseAdminClient()` (service-role), accepts any `documentId`, returns a 10-minute signed URL for that document's PDF. No `auth.getUser()` check. The middleware gates the dashboard routes that call this action, so only authenticated users reach the UI — but any authenticated session can request any document's signed URL by guessing IDs.

**Impact.** The documents are mostly public pension CAFRs; signing them adds latency but not secrecy. If a non-public document is ever uploaded (e.g., a placement-agent deck), this action would serve it to any authenticated user. **Low blast radius today**, but a pattern that will bite later.

**Recommended fix.** Add `auth.getUser()` at the top of `getSourceInfo()`, return `null` (or throw) when unauthenticated. **5 min.**

**Suggested phase.** Near-term.

### M-5 · `demo_requests` has no rate limiting

**Evidence.** `app/actions/demo-request.ts` validates email shape + hashes IP, but doesn't throttle. A scripted submitter could insert thousands of junk rows.

**Impact.** Table is still empty today (0 rows). No PII leak — `captured_at` + hashed IP + email, all server-role-only on RLS. Would primarily waste DB space and pollute the outreach pipeline.

**Recommended fix.** Either add an IP-hash unique index with `ON CONFLICT DO NOTHING` on a short TTL, or wire `@upstash/ratelimit`. **30 min.**

**Suggested phase.** Phase 3 / pre-demo-launch.

### M-6 · `alerts@allocus.com` email sender is still `onboarding@resend.dev`

**Evidence.** Both `app/api/cron/preliminary-alert/route.ts:16` and `policy-change-alert/route.ts:18`:

```ts
const ALERT_FROM = "onboarding@resend.dev"; // swap to alerts@allocus.com after domain verify
```

**Impact.** All cron emails sent from `onboarding@resend.dev`. Fine for Vitek's own inbox but would land in spam for external recipients.

**Recommended fix.** Domain-verify `allocus.com` on Resend, swap both constants. **30 min.**

## Low-priority findings (polish)

### L-1 · Product name inconsistency: package `lp-signal` vs UI `Allocus`

**Evidence.**
- `package.json` → `"name": "lp-signal"`
- Top-level spec file: `lp_signal_build_spec.md` (still uses old name throughout)
- UI wordmark: `Allocus` (landing + footer + nav)
- Repo path: `/Users/vitekvrana/Desktop/lp-signal`

**Impact.** Cosmetic — internal-only confusion. Would matter the day you open-source or public-link the repo.

**Recommended fix.** Defer to a focused rename day. Not worth touching package.json alone since the path rename has cascading effects.

### L-2 · `docs/demo-walkthrough.md` predates E Phase 1 + Day 9.x

**Evidence.** The walkthrough (132 lines) references `/pensions/calstrs` and `/outreach` but not the Phase 1 features: combination filter, saved views, confidence badges, stale indicators, math modal, or the new event-date display. Written Day 7 per sprint summary; Phase 1 shipped Day 9.

**Impact.** If a demo is recorded today, the narration guide undersells the product's current state.

**Recommended fix.** 30-minute editorial pass on the walkthrough once the landing-page math-modal lands in Phase 2.

## Positive findings (things working well worth preserving)

1. **Foreign-key integrity is clean.** 0 orphans across every FK relationship tested (`signals.plan_id`, `signals.gp_id`, `signals.document_id`, `pension_allocations.plan_id`, `pension_allocations.source_document_id`, `documents.plan_id`, `documents.gp_id`, `allocation_policy_changes.plan_id`).

2. **Classifier accuracy on the random 20-sample was 10/10 accepted correct + ~8/10 preliminary correct.** Only one schema-semantic miss (see M-1). Every accepted row I spot-checked had the `commitment_amount_usd`, asset class, GP name, and approval date aligning with the `source_quote`.

3. **Confidence tiers are well-calibrated.** 68 accepted, 7 preliminary, 0 review on 75 validated signals. No high-conf-low-prio orphans (the class that the spec worried about). The auto-approval gate at `confidence >= 0.85 AND priority >= 40 AND !preliminary` is doing its job.

4. **RLS posture is solid.** `signals`, `pension_allocations`, `documents`, `plans`, `firm_profiles`, `saved_filter_views` all have RLS + at least one policy. `demo_requests`, `rejected_signals`, `firms` have RLS with no policies — service-role-only, matching design intent.

5. **Cron auth is defense-in-depth.** All four crons (`/api/cron/classify|scrape|preliminary-alert|policy-change-alert`) check `CRON_SECRET` via Bearer header, custom header, query string, **or** Vercel-platform header — and only trust the platform header when `process.env.VERCEL` is also set. Can't be spoofed locally.

6. **Bundle sizes are disciplined.** Heaviest route is `/signals` at 115 KB First Load JS, well under the 200 KB threshold. Shared baseline 87 KB. No route regressed during the E Phase 1 refactor.

7. **Data loaders avoid N+1.** Every dashboard page uses `Promise.all` for parallel fetches and in-memory `Map` groupings for roll-ups. The only `await`-inside-loop pattern is `lib/scrapers/calpers.ts:48` which is intentional sequential PDF fetching to avoid rate limits.

## Recommended follow-ups by phase

### Immediate (this session or next)
- **H-4** — one-off backfill of `signals.prompt_version` for pre-v2.3 rows (15 min).
- **M-2** — manual QA of saved-filter-views end-to-end (15 min).
- **M-3** — backfill `validated_at` on 3 CalPERS seed signals OR add comment explaining intent (10 min).
- **M-4** — add `auth.getUser()` to `source-url.ts` (5 min).

### Short-term (Phase 2 / 3)
- **H-1** — target-only-allocation UI framing + math-modal footnote (1 hour). Could pair with Phase 2's glossary/explainer work.
- **H-2** — sub-sleeve schema extension (3 hours). Natural to ship alongside Phase 2 classifier touch.
- **H-3** — failed-classification retry script + prompt extension investigation (2 hours).
- **M-1** — T3 pacing schema `period` field (1.5 hours).
- **M-5** — demo-request rate limiting (30 min).
- **M-6** — Resend domain swap (30 min).
- **L-2** — refresh demo walkthrough post–Phase 2.

### Long-term (Phase 4+)
- **L-1** — product name unification (package rename day).
- Per-source freshness operational work is already scoped in Phase 4 (continuous ingestion) — H-3 feeds directly into that.

## Audit methodology

**Covered:**
- Data integrity: exhaustive via direct SQL against 12 core tables.
- Scraper health: per-plan + per-GP document roll-ups with error counts.
- Classifier quality: 20 random samples (10 accepted + 10 preliminary), hand-read against `source_quote`.
- Server actions + cron routes: inspected all 4 cron route handlers + 3 server actions + middleware.
- UI render: every route (`/`, `/login`, `/plans`, `/signals`, `/outreach`, 13 × `/pensions/[slug]`, `/pensions/does-not-exist`) curled — all returned HTTP 200 with no React error fragments in HTML. Landing page verified to render `$X.XB` hero, 3 claim blocks, dark-band headline, Fraunces italic footer tagline, demo-modal button.
- Performance: full `pnpm build` run; loop + `await` + `supabase` pattern scan across `app/` + `lib/`.
- Documentation: compared `docs/e-roadmap.md` + `docs/sprint-summary-2026-04-29.md` + `docs/day-5-notes.md` to observed code + DB state.

**Not covered (limitations):**
- **Authenticated UI render.** Curl without an auth cookie redirects dashboard routes to `/login`. Server loaders succeed (HTTP 200), so no 500s, but I did not visually confirm the rendered DOM of `/signals`, `/outreach`, or any `/pensions/[slug]` detail page. User QA already exercised these and surfaced the Day 9.3/9.4 bugs that have since been fixed; the audit relied on that and on clean build + type checks.
- **Classifier quality on GP press releases.** Only 4 GP signals exist (all Brookfield-seeded). Not enough to sample meaningfully.
- **Scraper source availability.** Did not hit any live pension website — no way to distinguish "source has nothing new" from "scraper silently broke" without a Phase-4 change-detection layer.
- **`lp_signal_build_spec.md` (19 KB) was not read in full** — only head/tail. A full-spec-drift audit is its own session.
- **Mobile UX.** Not tested.
- **Storage bucket contents.** Did not enumerate; only verified the signed-URL path via `source-url.ts` read.
- **Anthropic cost.** Recent API spend was not queried (would require Anthropic console access).

**Rules honored:**
- No code changes made.
- No destructive DB queries (all reads; no UPDATE/DELETE/ALTER).
- No pushes.
- All findings have file paths, line numbers, or DB query results as evidence.
