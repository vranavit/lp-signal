# Allocus 7-day sprint — April 22–29, 2026

## Shipped

**Day 1 — Base infrastructure + 3 pensions.**
Shared HTTP utility (realistic Chrome UA, Sec-Fetch-* headers, manual
redirect cap, typed `BotBlockedError` on 403/429). Refactored CalPERS,
NYSCRF, Blackstone scrapers to use it. Built WSIB (PMC PDFs), Michigan
SMRS (quarterly SMIB reports), PA PSERS (per-fund resolution PDFs)
scrapers. 12 new docs, 30 signals.

**Day 2 — 2 more pensions + 2 GPs.**
NYSTRS PE_Commitments.pdf rolling-log scraper, CalSTRS board-minutes
scraper, Apollo press-release scraper. KKR hit Playwright wall (pure
SvelteKit SPA, no SSR). 5 signals added, Apollo contributed zero (news
mix is investment-side not fundraise-side).

**Day 3 — ICP layer.**
CalSTRS filter fix (INV + semi + CalSTRSPrivateEquity prefixes).
`firm_profiles` schema + `/settings/firm-profile` UI. ICP relevance
scoring (asset class 40 + check size 30 + geography 20 + recency 10).
`/outreach` admin dashboard with asset / size / direction / recency
filters and CSV export.

**Day 4 — Allocation data stock.**
`pension_allocations` schema, `document_type='cafr'` enum extension.
CAFR classifier prompt (`v1.0-cafr`) + tool schema (`record_allocations`).
Classifier orchestrator branches on `document_type`; same
accept/preliminary/rejected tiers for allocation rows. Ingested full
CAFRs for CalSTRS (8 accepted rows), NYSCRF (9 rows), and partial
CalPERS; `/pensions/[slug]` profile page with color-coded gap table.

**Day 5 — Policy-change detection + unfunded budget headline.**
Filter-fix pivot on CalPERS: their full ACFR (30 MB) and AIR (1.3M
tokens) both overshoot Anthropic limits, so ingested CalPERS Affiliates
Asset Allocation item from board materials instead — 6 accepted rows.
NYSCRF preliminary spot-check: 9 of 9 verbatim-correct, bumped to
accepted. Ingested TRS Texas 2023 ACFR + Fund Insights, WSIB FY25 annual
report, plus CalSTRS FY23 and FY24 ACFRs for multi-year coverage.
`allocation_policy_changes` table with generated `change_pp` /
`change_direction` columns. `scripts/detect-policy-changes.ts` detected
3 changes across CalSTRS' three fiscal years. Added unfunded budget
math + per-class chips to profile page, and to `/outreach` with
threshold filter. First headline number: **$8.21B CalSTRS unfunded
private markets budget**.

**Day 6 — More coverage + audit trail.**
Brookfield press-release scraper (9 articles ingested). Ares hit
Cloudflare JS-challenge wall — hard-stopped. Florida SBA hit Akamai
edge wall — substituted Wisconsin SWIB per the Day-5 fallback rule.
Illinois TRS FY25 ACFR added (8 accepted rows with full actuals,
$77B AUM, +$2.3pp RE gap). Policy-change alert cron at
`/api/cron/policy-change-alert` with Resend digest email; validated
via curl. **Audit trail modal** — server action resolves Supabase
signed URLs (10-min TTL) with public source_url fallback; wired on
signal detail panel, signals table rows, and every allocation row on
pension profiles. **Pension profile polish**: 32px unfunded budget
hero, 3-card stat strip, per-class unfunded chips, Recent Signals
section (last 6 months, linked to detail).

**Day 7 — Public landing + demo collateral.**
`/` now renders a public marketing page with a live CalSTRS snippet
(real allocation table + $8.21B headline — no static screenshot, the
numbers come from `pension_allocations` at request time). Auth-aware
top-right link (Sign in / Go to dashboard). Demo-request modal with
server action + `demo_requests` table. `docs/demo-walkthrough.md` —
rehearsal script with recovery lines. This summary.

## Current data coverage

- **Active plans tracked:** 13
- **Plans with transaction data (signals ≥ 1):** 7
- **Plans with allocation data:** 7
- **GPs seeded:** 4 (Blackstone, Brookfield, KKR, Apollo — KKR/Ares walled)
- **Total signals (accepted + preliminary):** 75
- **Total allocations:** 74
- **Policy changes detected:** 3
- **Documents processed:** 234
- **Total classifier tokens over 7 days:** ~8.0 M
- **Estimated API spend over 7 days:** ~$35–45 total (Sonnet 4.6; 90/10
  to 80/20 input/output range).

## Architecture decisions

- **Confidence-tiered auto-approval:** ≥ 0.85 accepted, 0.70–0.85
  preliminary, < 0.70 rejected and logged in `rejected_signals` for
  drift tuning. Same thresholds for signals and for CAFR allocations.
- **Source provenance on every row.** Every signal and every allocation
  row carries `document_id`, `source_page`, and `source_quote`. Audit
  trail modal closes the loop with a signed PDF URL.
- **v2.3 classifier prompt** with private-markets-only scope (PE /
  Infra / Credit / RE / VC). Explicit reject rules for public-equity
  mandates, index allocations, aggregate program statistics, and
  direct-mortgage NOISE (learned from NYSCRF Community Preservation
  Corp rows on Day 1).
- **Separate `v1.0-cafr` prompt** and tool (`record_allocations`) for
  allocation extraction — different schema shape, different noise rules
  (individual fund listings, sub-category splits, historical tables).
- **Shared HTTP utility** (`lib/scrapers/http.ts`) with realistic Chrome
  headers + typed `BotBlockedError`. Defeated WAF on calstrs.com,
  michigan.gov, nystrs.org.
- **Additive migrations auto-apply** via `scripts/apply-migration.ts`.
  ALTERs / DROPs pause for manual SQL-editor application.
- **Generated columns** on `allocation_policy_changes.change_pp` and
  `change_direction` so the UI can sort/filter without recomputation.
- **ICP scoring is computed at query time**, not persisted per-signal.
  Editing the firm profile retroactively re-scores every signal on the
  next page load.

## Known gaps

- **Playwright wall (not crossed):** KKR (SvelteKit SPA), Ares (Cloudflare
  JS challenge), Florida SBA (Akamai edge block), and CalSTRS' semi-annual
  PE Activity Report (JS-gated archive). All would require a
  headless-browser layer; deferred by design for sprint scope.
- **CalPERS PERF allocation is structurally gone.** Board adopted a
  Reference Portfolio + Active Risk Limit "in lieu of a Strategic Asset
  Allocation" effective July 1, 2026. Only CalPERS Affiliate sub-plans
  still publish SAA tables; the $500B PERF itself no longer has one for
  us to extract.
- **Apollo zero yield.** Scraper is structurally correct; current news
  cycle is investment-side ("Apollo Funds acquire X") rather than
  fundraise-side. Will populate when fundraise releases land.
- **No Canadian pension coverage.** Patterns differ (CPP Investments,
  PSP, CDPQ); deferred.
- **No warm-intro relationship graph.** Staff directory ingestion +
  relationship pathfinding (Palantir-direction) was out of scope.
- **No writing assistant / email drafter.** Deferred — signal + audit
  trail is the durable moat; drafting is commodity.
- **CAFR schema collapses sub-sleeves.** CalSTRS' Risk Mitigating /
  Inflation / Innovation all map to "Other"; caused a false-positive
  policy change ("Other 10% → 0%") noted in `docs/day-5-notes.md`.
- **Signals dashboard relevance default is $1B–$5B** — Vitek's *fund
  size*, not *commitment size*. Editing the firm profile to $25M–$500M
  activates check-size scoring meaningfully.

## Next 14 days if continued

- **Playwright infra** as a single capability unlock: KKR, Ares, Florida
  SBA, CalSTRS real-time, OPERS. Adds ~5 pensions / 2 GPs at once once
  the headless-browser service is running.
- **Scale to 12–15 pensions with transaction data.** Candidates ranked
  and scoped on Day 0: PSERS (done), NYSTRS (done), WSIB (done),
  Michigan (done) + TRS Texas board minutes (pending), Oregon PERS,
  Ohio PERS, NC Retirement.
- **3–5 more pension CAFRs.** Oregon, Ohio, NC Retirement, NJ Division
  of Investment, Virginia Retirement. Each is ~$1 in tokens to ingest.
- **Multi-year CAFR backfill for every pension** so policy-change
  detection has a comparison basis across all 7+ allocation plans, not
  just CalSTRS.
- **Warm-intro relationship graph.** Ingest LinkedIn and staff-directory
  data per pension; build a name-to-name pathfinder. This is the
  Palantir-direction feature that makes the product 10× stickier.
- **Email digest for signals**, not just policy changes — daily or
  weekly personalized view sorted by relevance score against the firm
  profile.
- **Multi-user auth + firm-level permissioning** so IR teams can share
  one Allocus account with per-seat preferences.
