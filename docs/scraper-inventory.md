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
| `cafr-*` | `scripts/scrape-cafr-*.ts` | Annual CAFR / ACFR | various | weekly check (annual publish, 6-12 mo lag) | `/api/cron/scrape-cafr` | `0 18 * * 1` | One consolidated weekly cron fans out to each `scrape-cafr-*` target |

## Supporting infrastructure

| Endpoint | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/cron/classify` | `15 6 * * *` | Classify pending documents via Claude |
| `/api/cron/preliminary-alert` | `0 14 * * *` | Drift detector — 24h preliminary ratio per plan |
| `/api/cron/policy-change-alert` | `0 15 * * *` | Daily digest of target-allocation moves |
| `/api/cron/scraper-health-check` | `0 19 * * *` | Alerts when a source hasn't been checked in 2× its expected cadence |

Total cron count: **14** (11 scraping + classify + 2 alerts + health-check). Under the Vercel 15-cron hard stop. If/when we add Ohio PERS or NC Retirement scrapers they can share a `scrape-other-pension` daily cron.

## Deliberately skipped

- **Apollo press releases** — `lib/scrapers/apollo.ts` + `scripts/scrape-apollo.ts` exist and are functionally correct, but the current news cycle on `apollo.com/press-releases` is investment-side ("Apollo Funds acquire X") rather than fundraise-side, yielding 0 signals for 90 days. Not cron-scheduled. Re-enable if fundraise releases start landing.
- **KKR** — Pure SvelteKit SPA with no SSR. Requires headless browser. Deferred per Day 2 decision.
- **Ares** — Cloudflare JS challenge. Deferred.
- **Florida SBA** — Akamai edge block. Deferred; Florida SBA pension row carries a "Blocked by source" availability pill on `/plans` (see Day 9.3 H-2 fix).

## Fingerprint discipline

Each scraper invocation updates `public.scrape_fingerprints` (keyed on `source_key`) with:

- `last_checked_at` — set every run, even if nothing new was found.
- `last_changed_at` — set only when a new document was fetched / the source index hash changed.
- `last_hash` — SHA-256 of the source index or discovered URL list.

The health-check cron uses these timestamps to alert on silent failure.
