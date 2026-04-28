# Audit 3 — Visual / UX (2026-04-29)

Continuation of the institutional 5-audit pass. Audit 1 (data
integrity) closed 2026-04-28 on commit `ee33782`. Audit 2 (code
quality) closed 2026-04-29 on commit `60e2fcd`. Audit 3
examines visual rendering, mobile responsiveness, empty / error
states, accessibility, and tooltip/disclosure copy across the
production UI.

## Reproducibility metadata

| Field | Value |
|---|---|
| Audit performed | 2026-04-29 |
| Commit hash at audit start | `60e2fcd` |
| Dev server | `http://localhost:3000` (Next.js 14.2.18, authenticated session) |
| Auditor | Vitek Vrana (with assistance from Claude) |
| Methodology | User-directed visual walk-through across 8 representative plans + targeted sub-audits for empty / error / mobile / accessibility states |
| Tooling | Browser dev tools, manual visual inspection, viewport resize simulation |

## Scope limitations

This audit examines:

- Visual rendering of the consultants section across plans with
  different data densities and source-type mixes
- New UI affordances added in Audit 1 (LACERA "Coverage may be
  incomplete" disclosure, per-row "Verified Mon YYYY" caption,
  three-case section subtitle, ACFR rename in section copy)
- Mobile / narrow-viewport responsiveness
- Empty-state rendering (no plan_consultants rows)
- Error-state rendering (P3.4 from Audit 2: server-side query
  failures, malformed data, RLS denials)
- Tooltip and excerpt-on-hover surfaces (source link `↗` icon)
- Accessibility (lint-flagged a11y issues from Audit 2 P3.1
  plus broader keyboard / screen-reader coverage)

This audit does **not** examine:

- Data correctness in `plan_consultants` or other tables
  (Audit 1)
- Code quality, error handling shape, security risks (Audit 2)
- Schema design, indexes, RLS policy completeness (Audit 4)
- Production readiness, monitoring, deploy pipeline (Audit 5)
- Cross-browser rendering on browsers other than the auditor's
  primary browser
- Performance under load or rendering benchmarks
- Pages outside `/pensions/[slug]` (the consultant work shipped
  this week is the audit's primary focus)

**Visual coverage gap (in-session scope reduction)**: the
interactive visual walk-through originally planned as
sub-audit 3.1 was skipped. As a result, this audit could NOT
verify:

- Whether rendered pages display correctly at desktop or
  mobile viewport widths (no human walked the pages)
- Whether tooltips appear on hover or render correctly
- Whether browser console emits errors during page load
- Whether multi-year duplicate rows display in the expected
  order (FY25 above FY24)
- Whether the LACERA UI disclosure note actually renders
- Whether the empty-state branch (unreachable in production)
  would render correctly if triggered
- Cross-browser compatibility (only Chrome/Safari assumed)
- Accessibility audits (WCAG, keyboard navigation, screen
  reader)
- Loading states, skeleton screens, error toasts
- Any visual rendering quality (spacing, alignment, overflow,
  contrast)

These remain open as P3 findings (visual coverage gap). The
platform may have visual defects this audit did not surface.
Code-side review (sub-audit 3.1 below, replacing the originally
planned interactive walk) verifies that the rendering logic
**should** behave correctly given the data shapes, but does
not verify that the browser actually renders correctly.

## Selected pages for visual walk-through

| # | Plan | slug | URL | bucket | rationale |
|---|---|---|---|---|---|
| 1 | TRS Illinois | `trs_illinois` | `/pensions/trs_illinois` | high-data (10 consultants, 8 allocations) | multi-year duplicates exercise grouping + within-mandate sort |
| 2 | CalSTRS | `calstrs` | `/pensions/calstrs` | high-data (5 consultants, 23 allocations) | longest allocation table; tests page rhythm with a long allocation block above the consultants section |
| 3 | WSIB | `wsib` | `/pensions/wsib` | medium-data (4 consultants, 15 allocations) | manual-research-only Washington plan |
| 4 | NYSTRS | `nystrs` | `/pensions/nystrs` | medium-data (4 consultants, 11 allocations) | carries Audit 1 P2.2 resolved Meketa row with schedule-scan annotation |
| 5 | LACERA | `lacera` | `/pensions/lacera` | low-data (2 consultants, 12 allocations) | **must render the new "Coverage may be incomplete" disclosure** beneath the section subtitle |
| 6 | Colorado PERA | `colorado_pera` | `/pensions/colorado_pera` | low-data (1 consultant, 6 allocations) | sparse-plan rendering with a single consultant row |
| 7 | Florida SBA | `fsba` | `/pensions/fsba` | manual-research-only (5 firms) | tests the "Manually verified" all-manual subtitle |
| 8 | Ohio PERS | `ohio_pers` | `/pensions/ohio_pers` | mixed-source candidate (2 consultants) | tests the "X from ACFR · Y manually verified" mixed subtitle (subject to confirmation that the row split is actually mixed) |

**Empty-state coverage caveat**: all 20 active plans now have
≥1 consultant row in production, so the
`<ConsultantsSection rows={[]}>` empty-state branch cannot be
triggered organically. Audit 3 will visually verify it via
either a transient route override or by reading the empty-state
JSX in `app/(dashboard)/pensions/[slug]/page.tsx` and confirming
the rendered output against the Tailwind classes used.

## Summary

| Severity | Count | Open |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 0 | 0 |
| P2 | 5 | **3** (P2.1, P2.2 RESOLVED 2026-04-29; P2.5 added by Fix-3 pattern check) |
| P3 | 8 | **7** (P3.H RESOLVED 2026-04-29) |

No P0 or P1 visual/UX defects from the code-side review. Four
P2 findings cluster around missing Next.js boundary files
(`error.tsx`, `loading.tsx`) for the pensions route, an
unvalidated `source_url` protocol path that would render
`javascript:` URLs as clickable links, and a near-total absence
of responsive Tailwind classes (1 `sm:` class across 1,444
lines). Eight P3 findings include the three pre-audit
empty-state findings + smaller correctness/i18n/a11y nits.

**2026-04-29 update**: Fix 3 closed P2.1, P2.2, P3.H by
creating `error.tsx`, `loading.tsx`, `not-found.tsx` for the
`pensions/[slug]` route. Pattern check during Fix 3 surfaced
**P2.5** (new): 9 of 13 dashboard route segments still lack
the boundary file trio; the gap is dashboard-wide.

The audit does not verify any actual visual rendering — the
interactive walk-through was skipped in-session. Real visual
defects may exist that this code-side review cannot surface;
that gap is itself documented in Scope limitations and as
P3.B.

---

## Pre-audit findings — empty-state code review

Triggered by the discovery that no production plan has zero
`plan_consultants` rows (all 20 active plans now have ≥1 row),
so the `<ConsultantsSection rows={[]}>` empty-state branch is
unreachable in normal user navigation. Code-side review of the
empty-state JSX in `app/(dashboard)/pensions/[slug]/page.tsx`
lines 1241-1278 produced three findings before sub-audit 3.1
began.

### P3.A — Empty-state mailto exposes founder's work email to all authenticated users

The empty-state branch surfaces a `mailto:vitek@bloorcapital.com`
call-to-action on every plan page that has zero consultant
rows. Currently unreachable in production (all 20 plans have
data) but exposes risk on any plan addition or row deletion.
Visible to **non-admin users** including the current tester
(Nicholas, role=user) and any future tester or external demo
viewer.

```tsx
<a href="mailto:vitek@bloorcapital.com" ...>
  vitek@bloorcapital.com
</a>
```

Recommended fixes (any one suffices):

- Replace with `tips@bloorcapital.com` alias
- Replace with a contact-form route
- Gate the mailto behind `role === 'admin'`

Secondary note: if the existing email is kept, the literal
should be the full standard contact `vitek.vrana@bloorcapital.com`
(consistent with Vitek's primary email of record), not the
`vitek@…` short form currently in code.

**Severity: P3.** **Status: OPEN.** Not blocking — branch is
currently unreachable — but worth a 5-minute fix before any
external demo.

### P3.B — Empty-state branch is unreachable from production data, so visual drift is undetectable

All 20 active plans have ≥1 consultant row. If the Tailwind
classes or copy in the empty-state branch regress, no
production page surfaces the regression. The branch is
effectively un-tested by normal use.

Mitigation options:

- (a) Storybook or isolated component rendering
- (b) A dev-only `?test=empty` query-param hack on
      `/pensions/[slug]`
- (c) A dev-only `/pensions/empty-preview` route

**Severity: P3.** **Status: OPEN.** Process gap, not a defect
today.

### P3.C — mailto link has no fallback for users without a default mail client

The empty-state branch's only call-to-action is the mailto
link. There is no copy-to-clipboard fallback, no contact-form
alternative, no plain-text email display for manual copy. For
users on devices without a default mail client (some kiosks,
some browsers, users who use webmail exclusively without
configuring system defaults), the link is dead.

Combined with P3.A, the cleanest solution replaces the mailto
entirely with a small inline contact form or an external link
to an intake (Tally / Linear-style).

**Severity: P3.** **Status: OPEN.**

---

## Sub-audits

[To be populated by user-directed walk-through. Expected
sub-audit areas:]

- 3.1 — Consultants section rendering across the 8 plans
  (high-data, medium-data, low-data, manual-only)
- 3.2 — LACERA disclosure note rendering
- 3.3 — Per-row "Verified Mon YYYY" caption (manual_research
  rows)
- 3.4 — Source link `↗` icon + verbatim excerpt tooltip
- 3.5 — Mobile / narrow-viewport responsiveness
- 3.6 — Empty-state and error-state rendering (3 P3 findings
  already pre-loaded above from the code review)
- 3.7 — Accessibility (keyboard nav, focus states, screen
  reader semantics, the 3 P3.1 lint warnings from Audit 2)

---

## Sub-audit 3.1 — Code-side review of pension page rendering

In-session scope change: the originally planned interactive
walk-through was skipped. This sub-audit replaces it with a
factual review of the rendering logic in
`app/(dashboard)/pensions/[slug]/page.tsx` (1,444 lines)
against 9 evaluation criteria. The review verifies that the
JSX **should** behave correctly given the data shapes, but
makes no claim about actual browser rendering.

The 8-plan list selected during pre-audit is preserved in this
doc as future-walk reference — see "Selected pages for visual
walk-through" above.

### Criterion 1 — Page header / metadata rendering

- Plan name: `<h1 className="text-[22px] font-semibold ...">{plan.name}</h1>`. No fallback needed — `notFound()` is called earlier if the plan lookup fails.
- Country + tier prefix: `{plan.country} · Tier {plan.tier ?? "—"}`. Tier null-handling correct (`?? "—"`).
- AUM: rendered via the `MetadataRow` helper (lines ~1130). Uses `resolvePlanAum()` to choose between editorial `plan.aum_usd` and the latest CAFR-derived total, with a 0.5x-2x sanity guard. Has fallbacks for nulls.
- `formatUSD()` (from `lib/utils.ts`) produces `$X` / `$XK` / `$X.XM` / `$XB` based on magnitude — verified clean in Audit 2.
- Plan website: only rendered when `planWebsite` is truthy.
- "Most recent CAFR" + snapshot date: shows `—` when `latestAsOf` is null.
- No hardcoded plan-specific strings.
- **No findings.**

### Criterion 2 — Allocations section rendering

- Container: `<div className="overflow-x-auto"><table ...>` — table horizontally scrolls if it overflows the viewport. **Mobile note**: this is the only narrow-screen affordance for the data tables; layout doesn't restructure.
- Th columns: Asset Class / Accuracy / Target % / Policy Range / Actual % / Gap (pp) / $ Gap / audit-trail icon (8 columns).
- Numbers use `num tabular-nums` (monospace numerals, aligned).
- Percentages: `fmtPct` helper does `${v.toFixed(1)}%` — hardcoded 1 decimal place.
- NULL `actual_pct`: renders `—`.
- NULL `gap_usd`: renders `—`.
- Range-aware classification: when `min_pct + max_pct + actual_pct` are all present, renders `below band` / `in band` / `above band` chip with delta. Falls back to point-target gap otherwise.
- Static — not sortable / not filterable. Sub-sleeves rendered as indented child rows beneath their parent (`├` / `└` connectors).
- **No findings.**

### Criterion 3 — Investment Consultants section structure

- **Three subtitle cases handled correctly** (lines ~1281-1316):
  - `allCafr` (cafrCount === total): `"N advisors · Sourced from FY{YY} ACFR"`
  - `allManual` (manualCount === total): `"N advisors · Manually verified"`
  - mixed: `"N advisors · X from ACFR · Y manually verified"`
  - Case detection logic correctly counts `source_type` values and dispatches.
- **Mandate group order is hardcoded** (line 1230):
  ```ts
  const CONSULTANT_MANDATE_ORDER = ["general", "private_equity", "real_estate", "hedge_funds"] as const;
  ```
  Schema's `Specialty` type (in `scripts/populate-consultants.ts`) also includes `real_assets`, `infrastructure`, `fixed_income`, `public_equity`, `endowment_consulting`. Defensive fallback exists: `unknownMandates` sorts alphabetically after the known set. **See P3.D below.**
- Within-group sort: `fee_year DESC`, then `fee_usd DESC NULLS LAST`, then alphabetical tiebreak. Correct.
- Multi-year duplicates: rendered as separate rows (intentional per Audit 1 P3.2). Each carries its own FY{YY} label.

### Criterion 4 — Per-row consultant rendering

- Firm name: `row.consultant?.canonical_name ?? "—"` — safe optional-chaining fallback.
- Mandate type: rendered as a section header above the rows (not per-row badge), per the Phase 4 design decision.
- `fee_usd`: `row.fee_usd != null ? formatUSD(Number(row.fee_usd)) : <span className="text-ink-faint">—</span>` — null check is `!= null`, which catches both `null` and `undefined`. **Renders `—` for NULL** (not "$0", not "$NaN"). Correct.
- `fee_year`: `row.fee_year ? \`FY${String(row.fee_year).slice(-2)}\` : "—"` — produces "FY25" for 2025. Correct.
- "Verified Mon YYYY" caption — gating logic:
  ```ts
  const verifiedLabel =
    row.source_type === "manual_research" && row.last_verified_at
      ? new Date(row.last_verified_at).toLocaleDateString("en-US", {
          month: "short", year: "numeric", timeZone: "UTC",
        })
      : null;
  ```
  Correctly only renders for `source_type='manual_research'` rows. **See P3.F below** for the invalid-date edge case.
- Source URL `↗` icon: rendered for all rows; falls back to `linkUrl = row.source_url ?? row.document?.source_url ?? null`. When both are null, renders a `·` mid-dot placeholder.
- Tooltip on `↗`: `title={excerpt ?? "View source document"}` where excerpt is `source_excerpt` truncated to 250 chars + `…`. **See P3.E below** for native-title accessibility.
- `notes` field: NOT rendered in UI. Internal-only auditor metadata. Correct.

### Criterion 5 — LACERA UI disclosure (P2.6 mitigation)

- Table at line 1216:
  ```ts
  const INCOMPLETE_CONSULTANT_COVERAGE_NOTES: Record<string, string> = {
    lacera: "Coverage may be incomplete. The source ACFR's aggregate \"Consultants\" line implies additional firms beyond those shown.",
  };
  ```
- Lookup at line 736: `INCOMPLETE_CONSULTANT_COVERAGE_NOTES[params.slug] ?? null` — passed as `incompleteCoverageNote` prop into `ConsultantsSection`.
- Render gate: only when prop is truthy AND `rows.length > 0` (lives in the populated branch). Empty-state branch ignores the prop.
- Render markup: `<div className="mt-1.5 text-[11.5px] text-ink-faint italic">{incompleteCoverageNote}</div>` — italic, 11.5px, faintest text color, 1.5-unit top margin. Matches the "small caveat" pattern.
- **No findings.** Implementation is clean and generalizable.

### Criterion 6 — Empty-state branch

Trigger condition: `rows.length === 0` at the top of
`ConsultantsSection`. Renders a `card-surface` with header
"Investment Consultants", a small grey dot icon, the message
"Consultant data not yet available for this plan.", and a
`mailto:vitek@bloorcapital.com` call-to-action.

Already documented in pre-audit findings P3.A, P3.B, P3.C.
**Sub-audit 3.3 (empty-state code review) completed via those
findings.** No additional code-side defects in the empty-state
branch beyond what's already logged.

### Criterion 7 — Source URL handling

- Anchor: `<a href={linkUrl} target="_blank" rel="noreferrer">↗</a>`.
  - `target="_blank"` ✓
  - `rel="noreferrer"` ✓ (implies `noopener` in modern browsers)
- **URLs are NOT explicitly protocol-validated.** Passed as-is from the database. Trust assumption: `source_url` is populated only by ingestion code or the audit team (RLS gates writes to `plan_consultants`, and the only writers in code are server-side admin-client paths). **See P2.3 below.**
- NULL or missing `source_url`: rendered `·` placeholder (mid-dot, `aria-hidden`). Correct fallback.
- For LACERA Meketa rows NULLed in Audit 1 P1.1: source_url is NULL on those rows but `source_document_id` is preserved → `linkUrl` falls back to `row.document?.source_url`, which IS the LACERA ACFR URL. So the `↗` icon still renders and links to the document.

### Criterion 8 — Error handling at page level (cross-ref Audit 2 P3.4)

- Unknown slug: `notFound()` is called from `next/navigation` (line 117). Triggers Next's default 404 page.
- DB query failure (RLS denial mid-session, network error, timeout): **no try/catch around the Supabase query block.** Will throw and bubble up. The closest error boundary is the one in `app/(dashboard)/`, which **does not exist** for the pensions route.
- Files inventory:
  - `app/(dashboard)/pensions/[slug]/error.tsx` — **MISSING**
  - `app/(dashboard)/pensions/[slug]/loading.tsx` — **MISSING**
  - `app/(dashboard)/pensions/[slug]/not-found.tsx` — **MISSING**
  - `app/error.tsx` (top-level) — **MISSING**
  - `app/global-error.tsx` — **MISSING**

  Other dashboard routes (`signals/`, `explore/`, `outreach/`)
  all have `error.tsx` and `loading.tsx`. Pensions is the
  outlier.
- **See P2.1 (error boundary) and P2.2 (loading state) below.**

### Criterion 9 — Pattern check across the consultants UI

- **`fee_year=null + fee_usd=non-null` edge case**: handled correctly — each null check is independent. UI renders `$2.4M  —` for that combo (fee known, year unknown). Sensible.
- **Unknown `mandate_type` values**: handled defensively via `unknownMandates.sort()` fallback. New mandate types (e.g., `infrastructure`) sort alphabetically at the bottom. **See P3.D below.**
- **Unknown `source_type` values**: subtitle case detection handles only `cafr_extraction` and `manual_research`. The CHECK constraint allows 6 values total (`cafr_extraction, industry_knowledge, manual_research, rfp_database, press_release, plan_disclosure`); rows with the other 4 source types fall into the `mixed` else-branch by default, which is acceptable behavior but isn't intentional design. **Worth a future widening of the case detection if those source types are ever populated.** Logged as P3.G.
- **Hardcoded English strings**: every user-facing string is hardcoded en-US. "Investment Consultants", "Manually verified", "advisor"/"advisors", "Sourced from FY{YY} ACFR", "Verified {Mon YYYY}", the LACERA disclosure, the empty-state copy. **See P3.H below.**

---

## Sub-audit 3.2 — Mobile responsiveness (code-side)

Searched the entire `app/(dashboard)/pensions/[slug]/page.tsx`
for responsive Tailwind classes:

| Prefix | Count |
|---|---|
| `sm:` | **1** (line 1403, `gap-x-3 sm:gap-x-4` inside `ConsultantLineItem`) |
| `md:` | 0 |
| `lg:` | 0 |
| `xl:` | 0 |
| `2xl:` | 0 |

The page has effectively no responsive design. Narrow-screen
handling relies on:

- `max-w-5xl` (max width 1024px) on the outer wrapper
- `overflow-x-auto` on `<AllocationTable>` (table horizontally
  scrolls)
- `flex-wrap` on the metadata row + per-class chip strip
- `flex items-start justify-between gap-6` on the hero, with
  no `flex-col`/`flex-row` switch at narrow widths

The hero in particular juxtaposes the plan name + metadata
block on the left and the unfunded-budget widget on the right
via `justify-between`. On a phone (< 640px wide), this layout
will compress both blocks into very narrow columns or
horizontally overflow. The 3-column stat strip
(`grid grid-cols-3 gap-3`) does not switch to a single column
on narrow screens.

### P2.4 — Mobile responsive design effectively absent (1 `sm:` class in 1,444 lines)

The pension-detail page is **desktop-first with no responsive
restructuring**. Concerns:

1. Hero block uses `justify-between` with no `flex-col` switch
   on narrow widths → likely broken layout on phones.
2. Stat strip is `grid-cols-3` with no `sm:grid-cols-1` →
   3 cards squeezed into very narrow widths.
3. Allocation table relies on `overflow-x-auto` only — table
   horizontally scrolls on mobile, which is acceptable for
   data-dense tables but creates a discoverability problem
   (users may not realize they can scroll right).
4. The consultants section's 4-column grid
   (`grid-cols-[1fr_auto_auto_auto]`) is the same on mobile
   and desktop. Long firm names will truncate via the existing
   `truncate` class but may render uncomfortably tight.

**Severity: P2.** **Status: OPEN.** Not blocking for a desktop
demo, but blocking for any mobile-aware demo or for general
production access. **Cross-reference**: this is the
substantive UX gap that a real visual walk-through would have
caught immediately.

---

## Sub-audit 3.3 — Empty-state code review

Completed via the three pre-audit findings (P3.A, P3.B, P3.C).
No additional code-side defects in the empty-state branch
beyond those.

**Status: COMPLETE.**

---

## Sub-audit 3.4 — Error states (cross-ref Audit 2 P3.4)

### P2.1 — No `error.tsx` for the pensions route segment ✓ RESOLVED 2026-04-29

**Resolution**: created `app/(dashboard)/pensions/[slug]/error.tsx`
matching the canonical pattern used by `signals/error.tsx` and
`outreach/error.tsx`: `"use client"` directive, `useEffect`
hook calling `console.error("[/pensions/[slug]] route error:", error)`
so errors land in Vercel function logs in production, AlertTriangle
icon in a red pill, descriptive heading, error message + digest
display when present, RotateCw retry button via `Button`
component, and a "Back to all plans" link as a secondary recovery
path. Type-check exit 0; route compiles cleanly. Errors that
previously bubbled to the default Next.js error wall now render
in a consistent in-app card.

**Original finding below.**



`app/(dashboard)/pensions/[slug]/error.tsx` does not exist.
Other dashboard routes have one:

- `app/(dashboard)/signals/error.tsx` ✓
- `app/(dashboard)/explore/error.tsx` ✓
- `app/(dashboard)/outreach/error.tsx` ✓
- `app/(dashboard)/pensions/[slug]/error.tsx` ✗

If the Supabase query in the page throws (RLS denial after a
session expires, DB network blip, timeout), Next.js falls back
to the parent route segment's error boundary. The parent
(`app/(dashboard)/layout.tsx`) does not wrap children in an
error boundary, and `app/error.tsx` does not exist either, so
the user gets the default Next.js error wall.

**Severity: P2.** **Status: OPEN.** Adds two files
(`error.tsx` for graceful in-route messaging, plus optionally
a top-level `app/error.tsx` for catastrophic failures).
**Cross-reference: Audit 2 P3.4.**

### P2.2 — No `loading.tsx` for the pensions route segment ✓ RESOLVED 2026-04-29

**Resolution**: created `app/(dashboard)/pensions/[slug]/loading.tsx`
using the codebase's existing `Skeleton` and `TableSkeleton`
primitives from `@/components/ui/skeleton`. Skeleton matches
the page structure: back link, hero card (plan name on left
+ unfunded widget on right), 3-card stat strip, allocation
table (TableSkeleton 6 rows × 8 columns), and a consultants
section header. Cold-cache loads now show a structured
skeleton matching the final page geometry rather than a blank
screen.

**Original finding below.**

`app/(dashboard)/pensions/[slug]/loading.tsx` does not exist.
Other dashboard routes have one. Without a loading boundary,
the user sees the previous page's content (or a blank page on
first navigation) until all the parallel Supabase queries
resolve. Several of those queries (rollup + leaf allocations,
signals, signalsCount, docsCount, policyChanges,
consultantData) can take a noticeable second or two on cold
cache.

**Severity: P2.** **Status: ~~OPEN~~ → RESOLVED 2026-04-29.**

### P3.H — No `not-found.tsx` for the pensions route segment ✓ RESOLVED 2026-04-29

**Resolution**: created `app/(dashboard)/pensions/[slug]/not-found.tsx`
mirroring the "data ingestion in progress" empty-state aesthetic
already in `page.tsx` (calm grey dot, ink-muted heading, ink-faint
explanation, "Browse all plans" recovery link) so the experience
reads as part of the app rather than a generic 404. Triggered by
the existing `notFound()` call at `page.tsx:107` when a slug
doesn't resolve to a plan.

**Original finding below.**

`notFound()` is called when the slug doesn't match any plan.
Without a `not-found.tsx` in the route segment, Next.js shows
its default minimalist 404 page. **Severity: P3.** Status:
~~OPEN~~ → RESOLVED 2026-04-29.

### P2.5 (new, surfaced by Fix 3 pattern check) — Dashboard-wide boundary file gap

The Fix-3 pattern check (executed 2026-04-29 after closing
P2.1, P2.2, P3.H for `pensions/[slug]`) inventoried boundary
files across all 13 `app/(dashboard)/` route segments:

| Route segment | error.tsx | loading.tsx | not-found.tsx |
|---|---|---|---|
| (dashboard root) | — | — | — |
| admin | — | — | — |
| admin/ingestion | — | — | — |
| explore | yes | yes | — |
| outreach | yes | yes | — |
| pensions | — | — | — |
| **pensions/[slug]** | **yes** | **yes** | **yes** |
| plans | — | — | — |
| settings | — | — | — |
| settings/firm-profile | — | — | — |
| signals | yes | yes | — |
| signals/[id] | — | — | — |
| signals/review | — | — | — |

Findings:

- **9 of 13 route segments still lack `error.tsx` and
  `loading.tsx`** — only `explore`, `outreach`, `signals`, and
  the just-fixed `pensions/[slug]` have them.
- **12 of 13 route segments still lack `not-found.tsx`** —
  `pensions/[slug]` is the only one. Even routes with `error`
  + `loading` boundaries skip the 404 case.
- The `(dashboard)` root layout has no boundary either, so
  any uncaught error in the parent layout falls through to
  Next's default error wall.

**Severity: P2.** **Status: OPEN.**
Recommended: a follow-up sweep that ports the
signals/outreach/pensions patterns to the remaining route
segments. Lowest-cost approach is a single fix session adding
~10 small files (3 boundary types × the 9 routes that need
them, modulo whether 404s make sense for non-dynamic routes
like `settings/`). Cross-reference: this finding is the
generalization of P2.1 and P2.2 — closing it eliminates the
"signals/explore/outreach/pensions has them but admin/plans
doesn't" inconsistency that an institutional review would
flag.

---

## Sub-audit 3.5 — Tooltips and interactive states (code-side)

### P3.E — Native `title` tooltip on source-link icon is non-keyboard accessible

The `↗` source-link icon uses the native HTML `title`
attribute for the tooltip:
```tsx
<a ... title={excerpt ?? "View source document"} aria-label="View source document">↗</a>
```

Issues:

- Native `title` tooltips appear on **mouse hover only**.
  Keyboard users tabbing through the page never see the
  excerpt.
- Native tooltips can't be styled, don't preserve newlines,
  and have implementation-defined timing.
- The `aria-label` does provide semantics for screen readers,
  but it's a generic "View source document", not the verbatim
  excerpt.

Better practice: a real `<TooltipProvider>` from shadcn/ui or
Radix that opens on `:hover` AND `:focus-visible`, with full
styling control and proper ARIA.

**Severity: P3.** **Status: OPEN.** Cross-reference: Audit 2
P3.4 (error UX surface) and Audit 3 visual-coverage gap.

### Truncation logic verified

`source_excerpt` is truncated to 250 chars + `…` when longer.
This matches yesterday's spec. No defects in the truncation
itself.

---

## Sub-audit 3.6 — Pattern check + additional findings

### P2.3 — `source_url` is not protocol-validated before rendering as `<a href>`

```tsx
const linkUrl = row.source_url ?? row.document?.source_url ?? null;
// ...
<a href={linkUrl} target="_blank" rel="noreferrer">↗</a>
```

URLs are passed unmodified from the database into `href`. A
`javascript:`-scheme URL would render as a clickable link that
executes JS in the user's browser context. Not exploitable
today (we control all writers to `plan_consultants` and
`documents` tables; RLS denies writes from anon/authenticated
roles), but defensive practice is to validate the protocol.

Suggested fix in `ConsultantLineItem`:
```ts
const safeLinkUrl = linkUrl && /^https?:\/\//i.test(linkUrl) ? linkUrl : null;
```

**Severity: P2.** **Status: OPEN.** Defensive hardening, no
known exploit.

### P3.D — Hardcoded mandate group order is incomplete

```ts
const CONSULTANT_MANDATE_ORDER = [
  "general", "private_equity", "real_estate", "hedge_funds",
] as const;
```

The `Specialty` type in `scripts/populate-consultants.ts`
also defines `real_assets`, `infrastructure`, `fixed_income`,
`public_equity`, and `endowment_consulting`. The
`mandate_type` column in `plan_consultants` doesn't have a
CHECK constraint enforcing values, so any of these (or
arbitrary new strings) could land. Defensive fallback in code:
unknown mandates sort alphabetically beneath the known
4 — not broken, but not deterministic for the missing
official values.

Recommended: extend the order list to include all known
specialties in display priority. **Severity: P3.** Status:
OPEN.

### P3.F — `last_verified_at` invalid-date edge case renders "Verified Invalid Date"

If `last_verified_at` is somehow a string that
`new Date(...)` cannot parse (corrupt data, future schema
change), `.toLocaleDateString()` returns `"Invalid Date"`.
The UI would render `Verified Invalid Date` beneath the firm
name.

Real risk is minor: `last_verified_at` is `timestamptz` with
DB-level validation, so production won't produce bad strings.
But a defensive `isNaN(date.valueOf())` check would prevent
the failure mode if data ever drifts. **Severity: P3.**
Status: OPEN.

### P3.G — Unknown `source_type` values fall into "mixed" subtitle by default

The subtitle case detection counts only `cafr_extraction` and
`manual_research`. The CHECK constraint allows 4 more
(`industry_knowledge`, `rfp_database`, `press_release`,
`plan_disclosure`). If any row carries one of those, the
subtitle silently dispatches into the "mixed" else-branch
without naming the new source type. **Severity: P3.** Status:
OPEN. Worth widening the case detection when any of those
source types becomes populated.

### P3.I — All user-facing strings are hardcoded English (no i18n consideration)

Every string in the consultants section is hardcoded en-US:
"Investment Consultants", "advisor"/"advisors",
"Sourced from FY{YY} ACFR", "Manually verified",
"Verified {Mon YYYY}", "Coverage may be incomplete...", the
empty-state copy, and the `mailto:` exposure. No i18n
abstraction. Minor today since Allocus is US-only;
documented for future. **Severity: P3.** Status: OPEN.

---

## Recommended next steps

1. **P2.1** — add `app/(dashboard)/pensions/[slug]/error.tsx`
   matching the patterns in `signals/error.tsx`,
   `explore/error.tsx`, `outreach/error.tsx`. Optionally also
   add a top-level `app/error.tsx` for catastrophic failures.
2. **P2.2** — add
   `app/(dashboard)/pensions/[slug]/loading.tsx` with a
   skeleton matching the hero + 3-card stat strip + table
   layout. Improves perceived performance on cold cache.
3. **P2.3** — protocol-validate `source_url` and
   `document.source_url` before rendering as `<a href>` — one
   line, defensive hardening.
4. **P2.4** — responsive design pass on
   `app/(dashboard)/pensions/[slug]/page.tsx`. Highest impact:
   `flex-col md:flex-row` on the hero, `grid-cols-1 sm:grid-cols-3`
   on the stat strip, and a mobile-friendly approach to the
   allocation table (either keep `overflow-x-auto` with a
   visual scroll affordance, or restructure to a stacked
   card-per-row layout under `md:`).
5. **P3.A, P3.B, P3.C** (empty-state) — replace
   `mailto:vitek@bloorcapital.com` with `tips@bloorcapital.com`
   alias OR a contact-form route OR admin-only gating; add a
   dev-only `?test=empty` query-param to make the empty-state
   branch testable; consider a copy-to-clipboard fallback.
6. **P3.D** — extend `CONSULTANT_MANDATE_ORDER` to include
   `real_assets`, `infrastructure`, `fixed_income`,
   `public_equity`, `endowment_consulting` in display
   priority order.
7. **P3.E** — replace native `title` tooltip on source-link
   icon with a real Tooltip primitive (shadcn/ui or Radix),
   accessible to keyboard users.
8. **P3.F** — defensive `isNaN(new Date(x).valueOf())` check
   before formatting `last_verified_at`.
9. **P3.G** — widen subtitle case detection when other
   `source_type` values become populated.
10. **P3.H** — add `app/(dashboard)/pensions/[slug]/not-found.tsx`
    for a styled 404 instead of Next's default.
11. **P3.I** — i18n abstraction. Not urgent; flagged for
    future.
12. **Visual walk-through deferred.** To be executed in a
    separate session before any external demo. The 8-plan
    list selected during pre-audit is preserved in this doc
    as the walk's reference set. **Cross-reference: this
    audit's Scope limitations "visual coverage gap"
    paragraph.**
