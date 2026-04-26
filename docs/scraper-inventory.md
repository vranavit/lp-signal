# Scraper inventory

Established 2026-04-23 (Day 10 Session 1) during the continuous-ingestion build. One row per source; keep this current when scrapers are added, retired, or re-cadenced.

## Active scrapers

| Source key | File | Type | Source URL pattern | Expected cadence | Cron endpoint | Cron schedule (UTC) | Notes |
|---|---|---|---|---|---|---|---|
| `blackstone` | `lib/scrapers/blackstone.ts` | GP press releases | `blackstone.com/news/press/` | daily | `/api/cron/scrape-blackstone` | `0 14 * * *` | `--days=90` default, extended to 365 once via backfill script |
| `brookfield` | `lib/scrapers/brookfield.ts` | GP press releases | `bam.brookfield.com/press-releases` | daily | `/api/cron/scrape-brookfield` | `15 14 * * *` | `--days=90` default |
| `calpers` | `lib/scrapers/calpers.ts` | Board minutes (PDF) | `calpers.ca.gov/documents/...` | daily check (monthly meetings) | `/api/cron/scrape-calpers` | `0 16 * * *` | Historical + recent scrapers share the helper |
| `calstrs` | `lib/scrapers/calstrs.ts` | Board minutes (PDF) | `calstrs.com/files/...` | daily check (monthly meetings) | `/api/cron/scrape-calstrs` | `15 16 * * *` | JS-gated PE Activity Report is a separate Playwright problem — not in scope |
| `nyscrf` | `lib/scrapers/nyscrf.ts` | Monthly transaction reports (PDF) | `osc.state.ny.us/.../common_retirement_fund` | daily check (monthly publish) | `/api/cron/scrape-nyscrf` | `30 16 * * *` | Generates month candidates by date |
| `nystrs` | `lib/scrapers/nystrs.ts` | Board minutes (PDF) | `nystrs.org/getmedia/...` | daily check (monthly meetings) | `/api/cron/scrape-nystrs` | `45 16 * * *` | Rolling-log PDF |
| `pa_psers` | `lib/scrapers/pa-psers.ts` | Board resolution PDFs | `pa.gov/.../psers/documents/board...` | daily check (monthly meetings) | `/api/cron/scrape-psers` | `0 17 * * *` | Per-fund resolution PDFs |
| `michigan` | `lib/scrapers/michigan.ts` | Quarterly SMIB reports | `michigan.gov/-/media/.../SMRS` | daily check (quarterly publish) | `/api/cron/scrape-michigan` | `15 17 * * *` | SMIB quarterly |
| `wsib` | `lib/scrapers/wsib.ts` | Board meeting packets (PDF) | `sib.wa.gov/docs/meetings/...` | daily check (monthly meetings) | `/api/cron/scrape-wsib` | `30 17 * * *` | PMC PDFs |
| `oregon_pers` | `lib/scrapers/oregon.ts` | Board meeting packets + minutes (PDF) | `oregon.gov/treasury/invested-for-oregon/.../YYYY/*.pdf` | daily check (8 meetings/yr) | `/api/cron/scrape-pension-wave-2` (fan-out) | `45 17 * * *` | Oregon Investment Council; index-page scrape, 85 historical candidates |
| `ma_prim` | `lib/scrapers/ma-prim.ts` | Board meeting packets + minutes (PDF) | `mapension.com/wp-content/uploads/YYYY/MM/Board-Meeting-*.pdf` | daily check (4 meetings/yr) | `/api/cron/scrape-pension-wave-2` (fan-out) | `45 17 * * *` | PRIM; candidate-URL probe pattern, upload-month window ±3 around meeting date |
| `vrs` | `lib/scrapers/vrs.ts` | Board agendas + materials + minutes (PDF) | `varetire.org/media/members/pdf/board/{agendas,materials,minutes}/YYYY/*.pdf` | daily check (~monthly meetings) | `/api/cron/scrape-pension-wave-2` (fan-out) | `45 17 * * *` | Virginia Retirement System; index-page scrape, 75 candidates live (29 agendas + 29 materials + 17 minutes) |
| `nj_doi` | `lib/scrapers/nj-doi.ts` | Approved board minutes (PDF) | `nj.gov/treasury/doinvest/pdf/ApprovedMinutes/YYYY/*.pdf` | daily check (~monthly meetings) | `/api/cron/scrape-pension-wave-2` (fan-out) | `45 17 * * *` | NJ State Investment Council; index-page scrape, 142 historical candidates spanning 2008–2025 |
| `lacera` | `lib/scrapers/lacera.ts` | Board agendas + minutes (PDF) | `lacera.gov/sites/default/files/assets/documents/board/YYYY/BOI/YYYY-MM-DD-boi_{agnd,min}.pdf` | daily check (~monthly meetings) | `/api/cron/scrape-pension-wave-2` (fan-out) | `45 17 * * *` | LA County ERA; hybrid index (~10 current-year) + date-candidate probe (2nd Tues/Wed × 18 months) for older-year coverage |
| `minnesota_sbi` | `lib/scrapers/minnesota-sbi.ts` | Board meeting packets + minutes + approvals (PDF) | `msbi.us/sites/default/files/YYYY-MM/*.pdf` | daily check (~quarterly meetings) | `/api/cron/scrape-pension-wave-2` (fan-out) | `45 17 * * *` | Minnesota SBI; index-page scrape, 66 candidates live spanning 2020–2026 (22 materials + 23 minutes + 19 approvals + 2 other) |
| `cafr-*` | `scripts/scrape-cafr-*.ts` | Annual CAFR / ACFR | various | weekly check (annual publish, 6-12 mo lag) | `/api/cron/scrape-cafr` | `0 18 * * 1` | One consolidated weekly cron fans out to each `scrape-cafr-*` target |

## Supporting infrastructure

| Endpoint | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/cron/classify` | `15 6 * * *` | Classify pending documents via Claude |
| `/api/cron/preliminary-alert` | `0 14 * * *` | Drift detector — 24h preliminary ratio per plan |
| `/api/cron/policy-change-alert` | `0 15 * * *` | Daily digest of target-allocation moves |
| `/api/cron/scraper-health-check` | `0 19 * * *` | Alerts when a source hasn't been checked in 2× its expected cadence |

Total cron count: **15** (11 scraping + 1 wave-2 fan-out + classify + 2 alerts + health-check). Right at the Vercel 15-cron hard stop. Task C+ added Minnesota SBI into the `scrape-pension-wave-2` fan-out, bringing it to 6 sub-scrapers (Oregon, PRIM, VRS, NJ DOI, LACERA, Minnesota SBI) behind the single Vercel cron entry. New pension sources register themselves here instead of getting their own cron.

## Deliberately skipped

- **Apollo press releases** — `lib/scrapers/apollo.ts` + `scripts/scrape-apollo.ts` exist and are functionally correct, but the current news cycle on `apollo.com/press-releases` is investment-side ("Apollo Funds acquire X") rather than fundraise-side, yielding 0 signals for 90 days. Not cron-scheduled. Re-enable if fundraise releases start landing.
- **KKR** — Pure SvelteKit SPA with no SSR. Requires headless browser. Deferred per Day 2 decision.
- **Ares** — Cloudflare JS challenge. Deferred.
- **Florida SBA** — Akamai edge block. Deferred; Florida SBA pension row carries a "Blocked by source" availability pill on `/plans` (see Day 9.3 H-2 fix).
- **Ohio PERS** — `opers.org/about/board/meetings/` exposes only a dates-table with empty Agendas/Minutes columns; no public document index to crawl. Investigated in Session 2 and flagged blocked. Ohio PERS row exists in `plans` from Day 9.3 and carries the same "Pending ingestion" availability pill as the other blocked pensions.
- **Colorado PERA (board minutes)** — copera.org does not publicly publish Board of Trustees meeting minutes; the Board and Leadership page lists only governance documents (strategic plan, investment policy, standing-committee assignments, trustee statements on divestment). Task C+ investigation pivoted PERA to CAFR-only ingestion via `scripts/scrape-cafr-colorado-pera.ts`; no board-minutes scraper registered.
- **Wisconsin SWIB (allocation actuals)** — target-only by source design. The 2024 SWIB Annual Report (`swib.state.wi.us/wp-content/uploads/2026/03/2024-SWIB-Annual-Report.pdf`) explicitly states "target percentages may differ from actual monthly allocations" — the document carries policy targets and expected returns but no per-asset-class actuals. SWIB does not publish periodic actual asset class composition in any public document (the `/asset-allocation` page references a Target Benchmarks PDF and Investment Guidelines, both target-side). Allocation-actuals coverage stays target-only for SWIB until the policy posture changes; the existing `scripts/scrape-cafr-swib.ts` continues to ingest target rows for the unfunded-budget UI's "tracked with targets only" surface (per Day 9.5 H-1). Investigated in the actuals-gap sprint Phase 1 (Apr 2026) — see `docs/audits/duplicate-allocations-audit-2026-04-25.md` for the broader actuals-gap context.

## Fingerprint discipline

Each scraper invocation updates `public.scrape_fingerprints` (keyed on `source_key`) with:

- `last_checked_at` — set every run, even if nothing new was found.
- `last_changed_at` — set only when a new document was fetched / the source index hash changed.
- `last_hash` — SHA-256 of the source index or discovered URL list.

The health-check cron uses these timestamps to alert on silent failure.
