# E Roadmap: Dashboard robustness and demo-readiness

Established: 2026-04-23 (Day 9+)
Status: Phase 1 shipped (2026-04-23)

## Goal

Make the Allocus dashboard demo-ready without rough edges. Priority is dashboard core usability, data accuracy surface, and ease of understanding — NOT fancy features like email digest or shareable links.

## Phase 1: Dashboard core usability (this session, 3-4 hours)

1. Advanced filter system on /outreach and /signals
   - Combination filters: asset class × check size × geography × unfunded budget threshold × confidence tier × date range
   - Multi-select chip UI, clear/reset buttons, filter count badge
   - URL state: filters serialize to query params so they're shareable and back-button-safe

2. Saved filter views
   - User can save current filter combo as a named view ("Infra $50-200M US PE")
   - Retrieve views from a dropdown
   - Stored per-user in a new `saved_filter_views` table

3. Data accuracy surface (the "really robust" bar)
   - Every row shows confidence badge: Accepted (green) / Preliminary (yellow) / Review (gray)
   - Every row shows last-refreshed timestamp (relative: "2 days ago" or absolute on hover)
   - Every aggregate number ($8.21B unfunded budget etc.) has click-to-see-math modal explaining composition
   - Stale data flagged: signals >30 days old and allocations >90 days old get a subtle "stale" indicator
   - Extrapolated or estimated numbers labeled explicitly as such (not just "data")

4. Empty states and loading states
   - /outreach and /signals have clean empty states when filters return no results
   - Loading skeletons replace spinners on initial page load
   - Error boundaries on every data-fetch surface

## Phase 2: Clarity and explainability (later session, 3-4 hours)

1. Inline glossary tooltips on PE/infra terms (unfunded budget, policy change, commitment signal, DPI/TVPI, CAFR, etc.)
2. "How we calculated this" modals on aggregate numbers
3. First-time user onboarding tour (4-step walkthrough)
4. Mobile responsiveness polish on /outreach and /signals

## Phase 3: Demo enablement (later session, 2-3 hours)

1. Pension comparison view (select 2-4 pensions, side-by-side)
2. Signal detail pages (one signal per URL, full audit trail, related signals)
3. Public read-only share links (for demo handoff)

## Phase 4: Continuous ingestion (freshness guarantee) — partially shipped (Day 10 Session 1)

**Status:** infrastructure + per-source cron schedules + health-check + admin dashboard shipped; GP back-coverage scripted but not yet run; auto-ingestion on CAFR-landing-page changes deferred. See "Day 10 Session 1" subsection below for commit pointers and the live state.

After Day 9.4 fixed the signal date display to show true event dates instead of ingestion timestamps, many signals now correctly show as stale (>30 days since event). This is accurate but creates operational pressure: Allocus is only as fresh as its last scrape.

The fix is continuous re-scraping — checking every tracked pension source on a regular cadence so new events surface within 30 days of occurrence.

### Scope

1. **Scheduled re-scrape crons per pension source**
   - Board minutes (PSERS, NYSTRS, CalSTRS, etc.): check monthly (board meetings typically monthly or quarterly)
   - Monthly transaction reports (CalPERS, NYSCRF): check monthly
   - CAFR pages: check quarterly (new CAFRs drop 6-12 months after FY end)
   - GP press release pages: check daily

2. **Change detection**
   - Compare current page contents to last-seen hash
   - If new document detected → trigger classifier pipeline
   - If page structure changed (scraper broken) → alert

3. **Ingestion freshness metrics**
   - Per-source "last checked" timestamp visible in admin view
   - Aggregate "avg days to ingest" metric across all sources
   - Alert if any source hasn't been checked in 2× its expected interval

4. **Operational dashboard**
   - Internal-only `/admin/ingestion` view showing per-source status
   - Red/yellow/green indicator per source
   - Manual "re-check now" button per source

### Why this matters

- Value prop shifts from "we have data" to "we detect changes as they happen"
- Honest claim of freshness requires operational backing
- Makes Allocus a monitoring product, not just a database

### Deferred to Phase 4 because

- Requires working scraper infrastructure that's already solid (most scrapers are)
- Requires per-source cadence tuning (operational, not architectural)
- Phase 2 and Phase 3 work higher-ROI for closed beta stage (polish and demo features)
- Re-scraping costs more API tokens — worth cost-modeling before turning on broadly

### Prerequisites before starting Phase 4

- [ ] Phase 2 shipped (user-facing polish)
- [ ] Phase 3 shipped (demo features)
- [x] Verified existing scrapers are all stable (no silent breakages) — covered by the Day 10 Session 1 health-check cron
- [ ] API spend model updated to reflect continuous ingestion cost

### Day 10 Session 1 — shipped (2026-04-23)

Commits (stacked on the Day 9.5 chain, awaiting `git push`):

- `2d88de0` — **feat(scrapers): continuous re-scraping infrastructure with change detection + cron schedules**. `scrape_fingerprints` migration + `lib/scrapers/change-detection.ts` + `lib/scrapers/cron-shared.ts` (shared `runScrapeCron` wrapper) + `/api/cron/scrape-cafr` weekly heartbeat + `vercel.json` updated to 14 crons (under the 15-cron hard stop) + `docs/scraper-inventory.md`. Old `/api/cron/scrape` removed (superseded).
- `c92a1f4` — **feat(scrapers): per-source cron endpoints for all existing scrapers**. Nine per-source routes (Blackstone, Brookfield, CalPERS, CalSTRS, NYSCRF, NYSTRS, PSERS, Michigan, WSIB) — thin wrappers over existing scraper internals via `runScrapeCron`. Staggered 15-min starting at 14:00 UTC.
- `e549b62` — **feat(admin): ingestion health dashboard + scraper health-check cron**. `/admin/ingestion` (admin-gated, lists every fingerprint with green/yellow/red status + last-document link) + `/api/cron/scraper-health-check` (daily 19:00 UTC, Resend digest to vitek@bloorcapital when anything is stale >2× cadence).
- `a62daf3` — **feat(scrapers): GP press release back-coverage to 365 days (Blackstone + Brookfield)**. Both `scripts/scrape-{blackstone,brookfield}.ts` now accept `--days=N`, `--max-kept=N`, `--max-probed=N` flags. 365-day backfill **not auto-run** this session — spend cap + permission posture means the user runs the two commands manually when ready.

**DB migration NOT applied** — same posture as Day 9.5 H-2. Run manually:

```
set -a; source .env.local; set +a
pnpm tsx scripts/apply-migration.ts supabase/migrations/20260501000003_scrape_fingerprints.sql
```

After the migration applies, the cron endpoints write to `scrape_fingerprints` on every invocation and `/admin/ingestion` shows live status. Until then, the page renders "No fingerprints recorded yet" and the cron routes still succeed but fingerprint writes are no-ops (caught and logged).

**Covered by this session:**
- ✅ Scheduled re-scrape crons per source — 9 pension/GP daily + 1 CAFR weekly
- ✅ Change detection via content hash + fingerprint table
- ✅ Per-source "last checked / last changed / summary" visible on `/admin/ingestion`
- ✅ Scraper-health-check cron alerts on sources stale >2× expected cadence

**Still deferred (Phase 4 Session 2+):**
- Auto-trigger classifier pipeline when a CAFR landing page hash changes — currently the weekly `/api/cron/scrape-cafr` only fingerprints + alerts. Per-year URL curation for CAFR ingestion is still manual.
- Full "structured-change alert" (page structure changed, scraper broken) — today the only signal is `last_run_ok: false` in fingerprints.
- Classifier prompt gap fix from Day 9.5 H-3 (Gap 1: `null` numeric fields bypass omit rule) — unblocks 4 more CalPERS/WSIB docs.

### Fund fact sheet ingestion (Phase 4+)

Current limitation: some pensions publish allocation **targets** in the CAFR but **actuals** only in quarterly fund fact sheets or investment performance reports. 3 of 6 pensions with allocation data are currently target-only at their latest snapshot (NYSCRF 2025-03-31, WSIB 2025-06-30, Wisconsin SWIB 2024-12-31; TRS Texas 2025-08-31 reports non-PM classes only). 25 of 74 `pension_allocations` rows have `actual_pct IS NULL` and silently contribute `$0` to the unfunded-budget total.

Fix: per-plan ingestion of the most recent fund fact sheet / investment performance report to get current actuals. Estimated 1–2 hours per plan (one-off scraper each, similar to existing `scripts/scrape-cafr-*` but targeting the quarterly report URL).

Priority: **high for any plan that becomes a customer demo focus**. Surface this on the landing page + pension profile today (Day 9.5 H-1 fix) — visitors see "Based on N pensions with complete data. M tracked with targets only" rather than a headline that reads as a full number.

## Explicitly deferred

- Email digest functionality — nobody has requested it; existing crons are fine
- Cross-source data validation — Phase 5+ once there's a paying customer
- User-reported data corrections — Phase 5+

## Execution principle

Each phase is a self-contained session. Do not start Phase 2 in the same session as Phase 1. Document what shipped at the end of each phase before closing the session.

## Phase 1 — shipped (2026-04-23)

Commits on `main`, stacked on `bb118b4` (Day 9.2):

- `f51016c` — docs: E roadmap for dashboard robustness and demo polish
- `debf822` — E Phase 1.1: Advanced filters with URL state sync
- `5f12ad2` — E Phase 1.2: Saved filter views + saved_filter_views table
- `07439a1` — E Phase 1.3: Data accuracy surface — confidence badges, stale indicators, math modals
- `f09dd47` — E Phase 1.4: Empty states and loading skeletons

New surfaces:
- `components/filters/` — CombinationFilter, filter-state, use-url-filter-state, SavedViewsMenu
- `components/accuracy/` — ConfidenceBadge, TimeAgo, StaleIndicator, Extrapolated, MathModal, PensionHeroUnfunded
- `components/ui/empty-state.tsx`, `components/ui/skeleton.tsx`
- `app/(dashboard)/signals/{loading,error}.tsx`, `app/(dashboard)/outreach/{loading,error}.tsx`
- `app/actions/saved-filter-views.ts`
- `supabase/migrations/20260430000001_saved_filter_views.sql` (applied)

Deferred from Phase 1 into Phase 2:
- None. Full scope shipped.

Known caveats for the next session:
- Saved views delete does not confirm — one click removes. Consider a confirm prompt before Phase 3.
- The math modal only wraps the pension profile hero number. The landing-page hero $25.9B remains a plain display — Phase 2 ("How we calculated this" modals on aggregate numbers) will wrap it.

### Post-ship fixes (Day 9.3, 2026-04-23)

User QA surfaced three bugs the day Phase 1 shipped. Each fixed in its own commit on `main`:

- `ddbbd28` — **fix(outreach): null-safe filter for rows missing country or other fields**. Root cause: 4 GP-side press-release signals (Brookfield + Blackstone) have `plan_id IS NULL`; the Supabase relation returned `null` for `r.plan`, crashing the new combination-filter workspace at `r.plan.country`. Fix: added `plan:plans!inner(...)` + `.not('plan_id', 'is', null)` on the /outreach query so GP-only signals stay on /signals where they belong; added defensive `r.plan?.X ?? '—'` in the workspace. No DB mutation — plans.country is NOT NULL and all 13 rows are clean.
- `7d4116c` — **fix(plans): surface data availability status on list and detail pages**. Three plans (Florida SBA, North Carolina Retirement Systems, Ohio PERS) are seeded but have zero ingested data. The /plans list now counts per-plan signals/allocations/documents and renders a small availability pill next to the plan name ("Blocked by source" for Florida SBA via an in-code `KNOWN` map, "Pending ingestion" otherwise). /pensions/[slug] early-returns a calm "Data ingestion in progress" / "Blocked at source" state instead of empty tables. New file: `lib/plans/data-availability.ts`. Skipped the optional `data_availability_status` column on plans — code-side map is sufficient for 13 plans; promote to DB if it grows past ~20.
- `0620dc1` — **fix(signals): display true event date (approval/meeting) instead of ingestion timestamp across outreach, signals, pension profile, filters, stale indicator, and CSV export**. Diagnostic (2026-04-23) showed every row on /outreach reading "1d ago" despite the underlying board approvals spanning 2025-09-12 → 2026-03-19, because the age cell pointed at `signals.created_at` (ingest time) instead of the real event date. The real date already lived in `signals.fields.approval_date` (68/71 outreach-eligible rows) or in the joined `documents.meeting_date` (67/71). New helper `lib/signals/event-date.ts` exports `resolveEventDate(signal)` returning `{date, source: 'approval'|'meeting'|'ingestion'}`. Display swapped on all three row surfaces (outreach, signals table, pension-profile recent signals); `<TimeAgo>` extended with a `title` prop so the hover tooltip reads "Board approval date: 2025-09-12" / "Board meeting date: 2026-03-04" / "Event date unavailable. Showing ingestion date: …"; the ingestion-fallback case renders in amber. Date-range filter predicate on both workspaces now filters by resolved event date — **semantics change**: "Last 30 days" now means "event occurred in last 30 days", not "ingested in last 30 days" (what users actually want). `<StaleIndicator>` now checks event date, so many signals that were never flagged previously will correctly surface as stale from a fundraising perspective. CSV export gained `event_date` + `event_date_source` columns alongside `ingested_at`. Audit-trail modal shows a new Timeline field with "Board approval: YYYY-MM-DD" / "Ingested: YYYY-MM-DD". Data loaders unchanged — `fields` JSONB and `document.meeting_date` were already selected on /signals, /outreach, and the pension profile.
- `18f8d8f` — **fix(dashboard): clearer CAFR freshness labeling, refine stale indicator logic**.

### Day 9.5 — Audit findings fixes (2026-04-23)

Commits (all stacked on the Day 9.3/9.4 chain, awaiting `git push`):

- `30596c5` — **H-4**: `fix(signals): backfill prompt_version on 15 pre-v2.3 rows`. Applied to DB.
- `7d9d297` — **H-3**: `fix(pipeline): retry failed document processing + diagnose schema gaps`. Cleared the 2 storage_5xx errors (both docs now `processing_status='complete'`). Logged a prompt-gap in `docs/classifier-gaps.md` covering 4 docs where the classifier returns `null` for required numeric fields instead of omitting the signal. Per hard stop (>3 docs hidden by prompt gap), did **not** modify the prompt this session — Phase 2 work.
- `938b2f6` — **H-1**: `fix(allocations): honest labeling for target-only rows, document fund-sheet ingestion plan`. `unfundedUsd` helper now has a `privateMarketsUnfundedSummary` companion returning `{withActualsCount, targetOnlyCount, perClass with hasActuals}`. Landing hero now displays "Based on 3 pensions with complete target + actual data. 3 additional pensions tracked with targets only — actuals unavailable from current CAFR, so those plans are conservatively counted as zero gap." Pension profile gains an amber "Target-only for N asset classes" badge with tooltip when applicable; math modal breakdown splits actuals rows from excluded target-only rows and annotates the total as a low-side estimate. Phase 4 roadmap gained a "Fund fact sheet ingestion" subsection with the per-plan ingestion plan.
- `91c4f9c` — **H-2** (code only — DB side pending user action): `fix(allocations): add sub_class column, update classifier prompt to v1.1-cafr, backfill 7 sub-sleeve duplicates`. Schema + prompt + insert path updated; migration files + backfill script committed but **not yet applied** — sandbox paused on schema-change-to-shared-state. Run locally:
  ```
  set -a; source .env.local; set +a
  pnpm tsx scripts/apply-migration.ts supabase/migrations/20260501000001_pension_allocations_sub_class.sql
  pnpm tsx scripts/backfill-allocation-sub-class.ts
  pnpm tsx scripts/apply-migration.ts supabase/migrations/20260501000002_pension_allocations_sub_class_unique.sql
  ```
  Then re-run `scripts/detect-policy-changes.ts` to verify the false-positive CalSTRS "Other 10% → 0%" alert resolves. Expected state post-backfill: 0 duplicates on `(plan_id, as_of_date, asset_class, coalesce(sub_class,''))`.

Audit improvement: H-4, H-3 (partial — storage_5xx cleared, schema gap deferred), and H-1 fully shipped. H-2 code-complete, DB apply pending. Pension profile hero footer now reads "Most recent CAFR: FY YYYY · snapshot YYYY-MM-DD" with an info tooltip about typical 6–12 month publication lag. `PensionHeroUnfunded`'s math-modal footnote adds "Based on the most recent available CAFR (fiscal year YYYY) … new CAFRs are ingested within 7 days of public release." `StaleIndicator` gained two props: `signalType` (T2 target-change signals no longer fire the clock — they're CAFR-derived, not transactional) and `exempt` (allocation-kind now requires explicit `exempt={false}` to fire, defaulting off since CAFR-from-most-recent-available is fresh-as-possible by definition).
