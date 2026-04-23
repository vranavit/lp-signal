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
