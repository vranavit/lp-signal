# Session 2 Diagnostic — 2026-04-24

Investigation-only (no code / schema / data changes). Triggered by two
concerns surfaced during Session 2 verification:

1. Landing-page "pensions monitored" counter shows 7 despite 9 plans
   having signals after the Oregon PERS + Massachusetts PRIM additions.
2. A prior Terminal diagnostic claimed 0 signals meet the "Accepted"
   tier (confidence ≥ 0.85 AND priority ≥ 40), which contradicted the
   badges rendered on `/signals` and `/outreach`.

DB state at investigation time: 15 active plans · 130 signals · 9 plans
with signals · 7 plans with allocations.

## Finding 1: Landing page pensions counter undercounts by 5

**Counter source.** Two places on the landing page render the figure:

- `components/landing/hero.tsx:32` — the pill "Live data from N US public pensions"
- `components/landing/hero.tsx:71` — the hero-stat tile "Pensions monitored"

Both read `stats.pensionsMonitored` from `LiveStats`, which is produced by
`loadLiveStats()` in `app/page.tsx:88-155`. The counter is
`byPlan.size` on line 142, where `byPlan` is built from
`pension_allocations` rows only (lines 90-95, 111-115):

```ts
supabase
  .from("pension_allocations")
  .select("plan_id, asset_class, target_pct, actual_pct, total_plan_aum_usd, as_of_date")
// …
for (const r of rows) {
  if (!byPlan.has(r.plan_id)) byPlan.set(r.plan_id, []);
  byPlan.get(r.plan_id)!.push(r);
}
// …
pensionsMonitored: byPlan.size,
```

There is no signals-table read contributing to this count. The
admin-client read (`createSupabaseAdminClient`) bypasses RLS, so the
7 result is the true allocation-coverage number, not an auth artefact.

**Why it shows 7.** Allocations exist for **7** plans (CalSTRS, CalPERS,
NYSCRF, TRS Texas, WSIB, Wisconsin SWIB, TRS Illinois). Oregon PERS and
Massachusetts PRIM have validated signals but no ingested CAFR
allocation data, so the landing counter excludes them.

**Original hypothesis confirmed, but scope is wider than framed.** The
gap is not just the two Session 2 additions. Five plans currently
produce signals yet have zero rows in `pension_allocations`:

| Plan | Signals in DB | Reason no allocations |
|---|---|---|
| Michigan SMRS | present | Board-minutes scraper only; no CAFR ingested |
| NYSTRS | present | Board-minutes scraper only; no CAFR ingested |
| PA PSERS | present | Board-minutes scraper only; no CAFR ingested |
| Oregon PERS | 50 | Session 2 addition; CAFR ingestion not in scope |
| Massachusetts PRIM | 2 | Session 2 addition; CAFR ingestion not in scope |

The counter has therefore been undercounting since Michigan / NYSTRS /
PA PSERS went live (pre-Day-10). Session 2 widened the gap but did not
introduce it.

Inverse gap: `pension_allocations` has 3 plans with **no** signals
(TRS Texas, Wisconsin SWIB, TRS Illinois). Union across both tables is
**12 distinct plans**. `plans` table itself has **15 active** rows (the
three seeded-but-empty plans are Florida SBA, North Carolina Retirement
Systems, and Ohio PERS — see Day 9.3 `7d4116c`).

**Secondary observation.** `loadLiveStats`'s `catch` path at
`app/page.tsx:150` hardcodes `pensionsMonitored: 7`. That matches the
live value today by coincidence — neither reflects the intended scope
nor adjusts as new plans land. This fallback is reachable only if the
full `Promise.all` block throws, which is unlikely in practice but will
mislead on incident day.

**Proposed fix (NOT applied).** Two options:

1. **Union**: pull distinct `plan_id` from both `pension_allocations`
   and validated `signals`, return `byPlan.size ∪ sigPlans.size` = 12
   today. Honest but still excludes the 3 seeded-pending plans.
2. **Authoritative**: read `count(*) from plans where active = true`
   = 15 today. Matches `/plans` list and the tech-audit-noted design
   intent that seeded-but-empty plans are part of coverage.

(1) is tighter to "what the product actually has data on"; (2) is
easier to reconcile with the `/plans` page. Either is ~30 min of work.
No schema change either way. The landing-page "Based on N pensions with
complete data" caption on lines 81-95 already carries a separate honest
figure (`pensionsWithActuals`), so the hero number is free to be the
broader coverage figure without overstating the unfunded-budget math.

## Finding 2: Accepted tier criteria — code and data agree, the prior diagnostic was wrong

**Code criteria.** `components/filters/filter-state.ts:43-53`:

```ts
export function tierFor(confidence, priority, preliminary): ConfidenceTier {
  if (confidence < 0.70) return "review";
  if (preliminary) return "preliminary";
  if (confidence < 0.85) return "preliminary";
  if (priority < 40) return "preliminary";
  return "accepted";
}
```

Accepted = `confidence ≥ 0.85 AND priority_score ≥ 40 AND !preliminary`.
The function is the single source of truth — consumed by the badge
component, `/signals` workspace, and `/outreach` workspace:

- `components/accuracy/confidence-badge.tsx:34`
- `components/signals-workspace.tsx:82`
- `app/(dashboard)/outreach/outreach-workspace.tsx:155`

**Documentation.** `docs/proposals/confidence-tiered-auto-approval.md`
§2 defines Accepted as confidence ≥ 0.85 (with priority ≥ 40 named as
an "open question" in §9.1). The in-code comment block at lines 39-42
of `filter-state.ts` describes the rule as currently implemented. No
drift between proposal-as-shipped and code.

**Actual data distribution (130 signals):**

| Bucket | Count |
|---|---|
| All rows → accepted | 115 |
| All rows → preliminary | 15 |
| All rows → review | 0 |
| Visible on `/signals` (seed_data=false AND validated_at NOT NULL) → accepted | 112 |
| Visible → preliminary | 15 |
| Visible → review | 0 |

- `priority_score` is populated on **all 130 rows** (0 NULLs, 0 zeros).
  Distribution: 40-49 = 2, 50-59 = 11, 60-69 = 30, 70-79 = 74, 80-89 =
  13, 90+ = 0. The `priority < 40` gate has therefore never fired —
  classifier v2.3 appears to never emit sub-40 priority.
- `confidence`: 0 NULLs, 0 below 0.70, 15 in 0.70-0.85, 115 at ≥ 0.85.
- `preliminary` column: 117 false, 13 true.
- Cross-check: `conf ≥ 0.85 AND priority ≥ 40` returns **115** rows —
  exactly the Accepted count. The criteria match the data.

**So the prior Terminal claim of "0 Accepted" was false.** Root cause
found during this diagnostic: `scripts/check-signal-tiers.ts:11` selects
a nonexistent `status` column on `signals`. Supabase returns `{data:
null, error: PostgrestError}`; the script at line 14 does
`if (!signals) return;` and exits silently with no output. That
zero-output run is easy to misread as "zero signals match". Identical
shape of bug in `scripts/check-plans-real.ts:11`.

**Schema reality.** `signals` never had a `status` column. Searched
all migrations (`supabase/migrations/*.sql`): the only `status` is
`documents.processing_status`. The auto-approval proposal's design
(§3.1) used `preliminary` + `validated_at` + the `rejected_signals`
table; `status` was never added. The stale scripts in question
(`check-signal-tiers.ts`, `check-plans-real.ts`) were committed in
Session 2's `6500bff` "diagnostic utilities" commit carrying the
pre-existing schema mismatch.

**Proposed fix (NOT applied).** Either:

1. Edit both scripts to drop the `status` column reference (~10 min);
   add `if (error) throw error` guards so future schema drift errors
   loudly. Low risk, makes future diagnostics trustworthy.
2. Delete both scripts as superseded — `scripts/post-session2-state.ts`
   and `scripts/list-all-pensions.ts` already cover the inventory; this
   diagnostic file documents the tier distribution.

No code is changing here. No tier-logic drift to remediate.

## Finding 3: Session 2 ingestion integrity

### Oregon PERS — 50 signals, all well-formed

- Plan UUID `5eba4e3c-cf8a-41ff-b7bf-f1f850691bd5`.
- All 50 signals carry the correct `plan_id` (0 mismatches).
- Provenance: all have `document_id`, `source_page`, `source_quote`.
  Zero nulls across those three fields.
- Scores: `confidence` range 0.70 – 0.88, `priority_score` range 57 –
  83. No null scores.
- Tier breakdown: 42 accepted, 8 preliminary, 0 review.
- All 50 have `seed_data = false` and `validated_at` set — they render
  on `/signals` and `/outreach`.
- Signals were extracted from **11 distinct documents** (of the 30
  Oregon docs in the documents table). Average 4.5 signals per
  productive document.

### Massachusetts PRIM — 2 signals, perfect

- Plan UUID `6e1cf90a-dcbf-4086-add7-2e0baba39c5c`.
- Both signals have correct `plan_id`, full provenance, `confidence =
  0.95`, `priority_score = 74`, `preliminary = false`, and validated
  timestamps. Both render on the dashboard.
- Both drawn from 1 document (the 2025-12-04 board minutes PDF).

### Anomaly: 17 of 35 Session-2 documents are stuck in `processing_status='error'`

Not a signal-integrity problem — already-extracted signals are clean.
But ~49% of Oregon docs (14 of 30) and 60% of PRIM docs (3 of 5) never
yielded signals because their PDFs exceed the classifier's 100-page
limit. Every error carries the same class:

```
too_long: N pages (max 100)
```

Page counts observed: Oregon 102-252 pages, PRIM 122-141 pages. These
are the full OIC "Public Book" / PRIM board-packet PDFs (agenda +
minutes + manager presentations bundled). This is the **same error
class** as the 1 CalPERS Operating Memo batch already flagged in
Day 9.5 H-3 (`docs/retry-log-2026-04-23.md`). Not a new regression —
same cap.

The complete Oregon / PRIM documents that did classify are companion
smaller PDFs (standalone minutes, individual memos) that the scraper
discovered alongside the full packet. Provenance is correct — each
Oregon / PRIM signal links to a sub-100-page doc.

Raising the page cap OR chunking these packets into per-section sub-
documents would unlock ~17 more docs and likely 40-80 additional
signals. Estimated: 2-3 hours to implement PDF splitting; alternative
is increasing `MAX_PAGES` if Anthropic context allows. Scope beyond
this diagnostic.

## Separate finding: Stale diagnostic scripts commit `6500bff`

Session 2 landed three "diagnostic utilities" in commit `6500bff`:

- `scripts/check-signal-tiers.ts` — selects non-existent
  `signals.status` column; silently returns zero rows because of the
  `if (!signals) return` guard after a Supabase error.
- `scripts/check-plans-real.ts` — same `status` column bug, same
  silent-zero failure mode.
- `scripts/check-landing-counts.ts` — also selects `status` on signals
  but uses it only in an unused derived set; the rest of the script
  works, so its output is mostly correct.

The shared fragility is unchecked Supabase responses. A future audit
would benefit from a single convention: destructure
`{ data, error } = await …`, throw on `error`, so schema drift makes
noise instead of pretending to succeed.

## Recommended next session priority

1. **Fix the landing counter (Finding 1).** Highest urgency — it's
   user-facing on the homepage, and the claim is already misstated by
   5 pensions of real coverage. ~30 min including a semantic decision
   on which of the two options (union vs active-plans) becomes the
   hero number. Worth pairing with the Day 9.5 H-1 caption work, since
   both are honest-labeling concerns.
2. **Drop or repair the stale diagnostic scripts (Finding 2 / separate
   finding).** ~10-15 min. Prevents a repeat of today's misleading "0
   Accepted" readout.
3. **Session-2 documents stuck on 100-page cap (Finding 3 anomaly).**
   Lower urgency — signals already landed are fine — but raising the
   cap or chunking packets could yield ~40-80 more Oregon / PRIM
   signals without new scraper work. Fits naturally into a later
   pension-deepening session.

No issues found in the accepted-tier badge logic itself; `/signals`
and `/outreach` are rendering tiers correctly today.
