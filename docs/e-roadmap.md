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

## Explicitly deferred

- Email digest functionality — nobody has requested it; existing crons are fine
- Cross-source data validation — Phase 4+ once there's a paying customer
- User-reported data corrections — Phase 4+

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
- `18f8d8f` — **fix(dashboard): clearer CAFR freshness labeling, refine stale indicator logic**. Pension profile hero footer now reads "Most recent CAFR: FY YYYY · snapshot YYYY-MM-DD" with an info tooltip about typical 6–12 month publication lag. `PensionHeroUnfunded`'s math-modal footnote adds "Based on the most recent available CAFR (fiscal year YYYY) … new CAFRs are ingested within 7 days of public release." `StaleIndicator` gained two props: `signalType` (T2 target-change signals no longer fire the clock — they're CAFR-derived, not transactional) and `exempt` (allocation-kind now requires explicit `exempt={false}` to fire, defaulting off since CAFR-from-most-recent-available is fresh-as-possible by definition).
