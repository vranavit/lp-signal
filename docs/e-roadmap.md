# E Roadmap: Dashboard robustness and demo-readiness

Established: 2026-04-23 (Day 9+)
Status: Phase 1 in progress

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
