# CAFR URL patterns

Established 2026-04-27 as Phase 1 of PR 2 (Wave 1 adapters) under
sub-project B (CAFR auto-ingestion). One section per plan that the
weekly `/api/cron/scrape-cafr` heartbeat will auto-ingest, plus the
year-discovery strategy each adapter implements.

- **PR 2 (Wave 1, 5 adapters)**: shipped 2026-04-27 as commit
  `190aef3`. NYSCRF, Minnesota SBI, TRS Illinois, NJ DOI, MA PRIM.
- **PR 3 (Wave 2a, 9 adapters)**: documented below alongside Wave 1.
  CalPERS, Ohio PERS, PA PSERS, LACERA, Oregon PERS, VRS (single
  year-encoded); Michigan SMRS (WordPress publish-folder); NCRS
  and WSIB (quarterly snapshot).
- **PR 3.5 (Wave 2b, 1 adapter)**: deferred. CalSTRS uses an opaque
  Drupal hash in its CAFR URL - needs an HTML-scrape adapter shape
  not yet built.

A few notes on what the existing Wave 1 docs below describe vs what
shipped: the 15-month FYE recency filter was extended to 24 months
during PR 2 design (NJ DOI's 12-18 month publish lag would have
rejected legitimately-fresh ACFRs). The "Path A" landing-page
heartbeat tightening described in some Wave 1 sections was rejected
in favor of "Path B": the adapter probe IS the change-detection
signal. PR 4 will refactor `/api/cron/scrape-cafr` to call adapters
directly via the `CAFR_ADAPTERS` registry rather than hashing landing
pages.

## What an adapter has to do

Each adapter is a pure function from "current calendar date" to
"ordered list of candidate CAFR PDF URLs to try this run". The
heartbeat takes the first URL whose HEAD/GET returns HTTP 200 + a
PDF content-type, hands the bytes to `ingestCafr()`, and stops. The
ingest helper's content-hash dedup already prevents re-inserting a
PDF we've already classified, so re-trying last year's URL on every
run is fine. The adapter does NOT need to track whether we already
have the doc - that's the ingestor's job.

Per the architecture refinements approved before PR 2:

- **Cap at 1 CAFR per plan per heartbeat run.** As soon as one
  candidate returns a fresh PDF, stop probing. No double-pulls of
  year-N + year-N-1 in the same run.
- **24-month FYE recency filter.** Reject any candidate URL whose
  encoded fiscal-year-end is older than (today minus 24 months).
  Stops the adapter from happily re-ingesting a 2018 ACFR if the
  pattern accidentally matches.
- **Probe budget.** Cap candidate URL probes at 24 per plan per run.
  Most adapters will need 2 to 4; MSBI and MA PRIM (publish-month
  folders) need up to 24.
- **Failure escalation.** First failure on a plan: normal log entry.
  Second consecutive: HIGH PRIORITY in the digest. Third
  consecutive: write to the `broken_adapters` log and skip this
  plan on subsequent runs until manually re-enabled. Implemented
  in PR 4.

## Wave 1 plans

5 plans total. All five have year-encoded URLs (vs Wave 2's HTML
scrape pattern), which is why they batched first - the adapter
reduces to "compute the right URL for today's date".

### 1. NYSCRF (New York State Common Retirement Fund)

- **Plan key:** `nyscrf`
- **Heartbeat landing URL (set in PR 1):** `https://www.osc.ny.gov/retirement/about-nyslrs`
- **Manual fallback script:** `scripts/scrape-cafr-nyscrf.ts`
- **Fiscal year end:** March 31 (NYSLRS fiscal calendar runs Apr 1 to Mar 31)
- **File size:** 3.05 MB, 222 pages
- **Latest known PDF (FY2025):** `https://www.osc.ny.gov/files/retirement/resources/pdf/annual-comprehensive-financial-report-2025.pdf`

**URL pattern:**

```
https://www.osc.ny.gov/files/retirement/resources/pdf/annual-comprehensive-financial-report-{YYYY}.pdf
```

The `{YYYY}` is the calendar year of the FYE (e.g. FY2025 ended
2025-03-31, so `YYYY=2025`).

**Year-discovery strategy:**

Publish lag is roughly 7-9 months after FYE (March-end FY2025 ACFR
landed by November 2025). On any given run:

1. Try `YYYY = current_calendar_year`. After Oct 31 of year Y, this
   should resolve to year-Y's ACFR (covering FY ended Mar 31 of
   year Y).
2. If 404, fall back to `YYYY = current_calendar_year - 1`. Covers
   the early-year window (Jan 1 to ~Oct 31) before the new ACFR
   posts.

Probe count: 1 to 2.

**Quirks:** None notable. Stable URL pattern across multiple years
(verified back to FY2022). The osc.ny.gov host serves PDFs without
bot-blocking.

**Earliest acceptable FYE under the 24-month filter:**
`today() - 24 months`. On 2026-04-27 the cutoff is 2024-04-27.
FY2024 (FYE 2024-03-31) fails by 27 days; FY2025 (FYE 2025-03-31)
passes by 11 months.

---

### 2. Minnesota SBI (Minnesota State Board of Investment)

- **Plan key:** `minnesota_sbi`
- **Heartbeat landing URL (already seeded, broad):** `https://www.msbi.us`
- **Recommended tightening for PR 2 Phase 2:** `https://www.msbi.us/board/publications` or the equivalent Annual Report archive page. The bare `msbi.us` root will hash-flip on any unrelated homepage edit. Probe and confirm the right path during Phase 2.
- **Manual fallback script:** `scripts/scrape-cafr-minnesota-sbi.ts`
- **Fiscal year end:** June 30
- **File size:** 3.9 MB
- **Latest known PDF (FY2025):** `https://www.msbi.us/sites/default/files/2026-03/2025%20MSBI%20Annual%20Report.pdf`

**URL pattern:**

```
https://www.msbi.us/sites/default/files/{PUB_YYYY}-{PUB_MM}/{FY_YYYY}%20MSBI%20Annual%20Report.pdf
```

Two independent variables:

- `{FY_YYYY}` is the calendar year of the FYE (FY2025 ended
  2025-06-30, so `FY_YYYY=2025`).
- `{PUB_YYYY}-{PUB_MM}` is the publish-month folder, e.g.
  `2026-03` for the FY2025 report. This is a Drupal date-organized
  upload path and we can't derive it from the FYE alone.

**Year-discovery strategy:**

Publish lag is roughly 6-9 months after the June-end FYE, but the
exact upload month varies. The FY2025 report landed in March 2026
(9 months); historical reports have landed Aug-Mar of year FY+1.
Probe approach:

1. For `FY_YYYY` in [`current_calendar_year`, `current_calendar_year - 1`]:
   - For `PUB_YYYY` in [`FY_YYYY + 1`, `FY_YYYY`]:
     - For `PUB_MM` in `["08", "09", "10", "11", "12", "01", "02", "03", "04", "05", "06", "07"]`:
       - Try the URL.
       - On 200 + PDF, return.

Hard cap at 24 probes per run (2 fiscal years x 12 months,
intersected with the calendar-feasibility filter so we don't probe
a future month).

Probe count: typically 1 to 12, capped at 24.

**Quirks:** Filename uses URL-encoded space (`%20`). The msbi.us
host has been stable on this scheme for at least 5 years
(verified 2020-onwards in the existing board-minutes scraper at
`lib/scrapers/minnesota-sbi.ts`). Some annual reports have used
"Annual%20Report" vs "MSBI%20Annual%20Report" naming; current
canonical form is `{FY_YYYY}%20MSBI%20Annual%20Report.pdf`. If
that fails, try `{FY_YYYY}%20Annual%20Report.pdf` as a backup
filename per probed month.

**Earliest acceptable FYE under the 24-month filter:**
On 2026-04-27 the cutoff is 2024-04-27. FY2024 (FYE 2024-06-30)
passes by ~2 months; FY2025 (2025-06-30) passes comfortably.

---

### 3. TRS Illinois (Teachers' Retirement System of Illinois)

- **Plan key:** `trs_illinois` (verify via DB during Phase 2 - manual script uses `name='TRS Illinois'` lookup, not key lookup)
- **Heartbeat landing URL (set in PR 1):** `https://www.trsil.org/financial/acfrs`
- **Manual fallback script:** `scripts/scrape-cafr-illinois-trs.ts`
- **Fiscal year end:** June 30
- **File size:** ~5 MB
- **Latest known PDF (FY2025):** `https://www.trsil.org/sites/default/files/documents/ACFR-FY25-web_0.pdf`

**URL pattern:**

```
https://www.trsil.org/sites/default/files/documents/ACFR-FY{YY}-web{SUFFIX}.pdf
```

Two variables:

- `{YY}` is the 2-digit calendar year of the FYE (FY2025 = `YY=25`).
- `{SUFFIX}` is either empty (`""`) or `"_0"` (Drupal node-revision
  suffix that appears when the file was re-uploaded). The current
  FY2025 PDF has `_0`; FY2024 may or may not. Probe both.

**Year-discovery strategy:**

Publish lag is roughly 4-6 months after June-end FYE (FY2025
landed by ~Oct/Nov 2025).

1. For `YY` in [`current_calendar_year_2digit`, `current_calendar_year_2digit - 1`]:
   - For `SUFFIX` in [`""`, `"_0"`, `"_1"`]:
     - Try the URL.

Probe count: 2 to 6.

**Quirks:**

- 2-digit year encoding (FY25, not FY2025). Easy to get wrong on
  the year-2099 rollover but we have plenty of runway.
- The `_0` / `_1` suffix is Drupal-specific. Older PDFs may have
  no suffix; freshly re-uploaded ones get `_0`, then `_1` if
  uploaded a third time. Probe `""` first, then `_0`, then `_1`.
- The plan row may use `name='TRS Illinois'` rather than a
  `scrape_config.key`. Phase 2 needs to confirm and standardize on
  `key='trs_illinois'` so the heartbeat dispatcher can resolve
  the plan consistently.

**Earliest acceptable FYE under the 24-month filter:** Same as
MSBI - on 2026-04-27, both FY2024 and FY2025 pass the filter.

---

### 4. NJ DOI (New Jersey Division of Investment)

- **Plan key:** `nj_doi`
- **Heartbeat landing URL (already seeded, broad):** `https://www.nj.gov/treasury/doinvest/`
- **Recommended tightening for PR 2 Phase 2:** `https://www.nj.gov/treasury/doinvest/publications/` or the SIC Annual Reports listing page. The current value is the division homepage and will hash-flip on every announcement edit.
- **Manual fallback script:** `scripts/scrape-cafr-nj-doi.ts`
- **Fiscal year end:** June 30
- **File size:** 0.8 MB (smallest of the Wave 1 batch)
- **Latest known PDF (FY2024):** `https://www.nj.gov/treasury/doinvest/pdf/AnnualReport/AnnualReportforFiscalYear2024.pdf`

**URL pattern:**

```
https://www.nj.gov/treasury/doinvest/pdf/AnnualReport/AnnualReportforFiscalYear{YYYY}.pdf
```

`{YYYY}` is the 4-digit calendar year of the FYE.

**Year-discovery strategy:**

Publish lag has historically been 12-18 months after June-end FYE
(FY2024 covers period ending 2024-06-30 and is the latest
available as of 2026-04-27 - so a long lag, much longer than the
other Wave 1 plans). This means the adapter often won't find
anything new for many runs in a row, which is fine.

1. For `YYYY` in [`current_calendar_year - 1`, `current_calendar_year - 2`, `current_calendar_year`]:
   - Try the URL.

Note the unusual ordering: NJ DOI's lag is long enough that
last-year's report is the most likely hit, not this-year's. Try
`current_year - 1` first, then `current_year - 2` (already-known
fallback), then `current_year` (in case they sped up publication).

Probe count: 1 to 3.

**Quirks:**

- Long publish lag (12-18 months) means the heartbeat will
  legitimately find no new doc for many consecutive runs. The
  failure-escalation ladder (1st normal, 2nd HIGH, 3rd
  broken_adapter) needs to NOT count "no new file found" as a
  failure - only count HTTP errors / non-PDF responses as
  failures. A 404 on `current_year` followed by a 200 on
  `current_year - 1` is success, not failure.
- The Division publishes an SIC Annual Report rather than a
  GFOA-style ACFR. Same allocation table, different document
  conventions - already handled by the v1.3-cafr classifier.
- File path uses `AnnualReport` (no hyphen, no underscore) and
  `AnnualReportforFiscalYear{YYYY}` (camelCase, no separator).
  Stable across multiple years.

**Earliest acceptable FYE under the 24-month filter:** Cutoff on
2026-04-27 is 2024-04-27. FY2024 (2024-06-30) passes by ~2 months;
FY2023 (2023-06-30) fails. NJ DOI's 12-18 month publish lag was
specifically the binding constraint that pushed the recency filter
from 15 to 24 months during PR 2 design - at 15 months, FY2024
would have failed and we could have been blocked from re-ingesting
the most recent published ACFR.

This is also the canonical case where "adapter found nothing" is
the correct outcome for many runs in a row, until FY2025 publishes
sometime in 2026.

---

### 5. MA PRIM (Massachusetts PRIM Board)

- **Plan key:** `ma_prim`
- **Heartbeat landing URL (already seeded, broad):** `https://www.mapension.com`
- **Recommended tightening for PR 2 Phase 2:** `https://www.mapension.com/publications/annual-reports/` or equivalent. The bare mapension.com domain hash-flips constantly.
- **Manual fallback script:** `scripts/scrape-cafr-ma-prim.ts`
- **Fiscal year end:** June 30
- **File size:** 2.9 MB
- **Latest known PDF (FY2025):** `https://www.mapension.com/wp-content/uploads/2025/12/PRIT-Annual-Comprehensive-Financial-Report-06302025.pdf`

**URL pattern:**

```
https://www.mapension.com/wp-content/uploads/{PUB_YYYY}/{PUB_MM}/PRIT-Annual-Comprehensive-Financial-Report-{MMDD}{FY_YYYY}.pdf
```

Three variables:

- `{FY_YYYY}` is the 4-digit calendar year of the FYE.
- `{MMDD}` is always `0630` (June 30 FYE encoded as MMDD).
- `{PUB_YYYY}/{PUB_MM}` is the WordPress upload folder, e.g.
  `2025/12` for the FY2025 report. Like MSBI, this can't be
  derived from the FYE alone.

**Year-discovery strategy:**

Publish lag has been 5-6 months for recent years (FY2025 ended
2025-06-30 and posted Dec 2025).

1. For `FY_YYYY` in [`current_calendar_year`, `current_calendar_year - 1`]:
   - For `(PUB_YYYY, PUB_MM)` ordered candidates: November/December
     of `FY_YYYY`, January/February of `FY_YYYY + 1`,
     October/November of `FY_YYYY` as backups.
     Concretely:
     - `({FY_YYYY}, "12")`
     - `({FY_YYYY}, "11")`
     - `({FY_YYYY + 1}, "01")`
     - `({FY_YYYY + 1}, "02")`
     - `({FY_YYYY}, "10")`
     - `({FY_YYYY + 1}, "03")`

Probe count: 1 to 12, capped at 24.

**Quirks:**

- Hyphen-separated filename with the FYE encoded inline as
  `06302025`. Different convention from the other 4 plans (which
  encode just the year).
- Older PRIT ACFRs have used variant filenames: `PRIT-ACFR-FY2025.pdf`
  or `PRIT-Annual-Report-FY25.pdf` style. The current canonical
  form is the long version. If the long form fails for
  recent fiscal years, try the FY{YY} short form as a backup
  per probed month (Phase 2 tuning).
- WordPress upload folder structure (`{YYYY}/{MM}/`) is stable -
  PRIM has used the same WP install for 5+ years.

**Earliest acceptable FYE under the 24-month filter:** On
2026-04-27 the cutoff is 2024-04-27. Both FY2024 (2024-06-30) and
FY2025 (2025-06-30) pass. FY2025 already ingested as of the
manual run, so first auto-ingest hit will be FY2026 around
Dec 2026.

---

## Wave 2a plans

9 plans whose CAFR URLs are predictable from calendar date alone (no
HTML scrape needed). Documented after Wave 1 because they reuse the
same adapter shapes - most slot directly into the patterns shipped
in PR 2. Grouped below by pattern shape rather than alphabetically.

### Group A - Single year-encoded URL (6 plans)

Same shape as Wave 1's NYSCRF: one `{YYYY}` (or `{YY}` / `fy{YYYY}`)
substitution into a stable URL template. Two probes per run (today's
year, prior year), future-FYE filter applies, ~1-2 candidates emitted
per run after the filter.

#### 6. CalPERS

- **Plan key:** `calpers`
- **Manual fallback script:** `scripts/scrape-cafr-calpers.ts`
- **Fiscal year end:** June 30
- **File size:** 30.4 MB raw (FY2025 ACFR). Routes through Anthropic's
  Files API path (already shipped in commit `2dc1d09`) because
  base64 inflation pushes it past the 32 MB inline ceiling. The
  adapter just emits the URL; ingestCafr handles the size routing.
- **Latest known PDF (FY2025):** `https://www.calpers.ca.gov/documents/acfr-2025/download?inline`

**URL pattern:**

```
https://www.calpers.ca.gov/documents/acfr-{YYYY}/download?inline
```

`{YYYY}` is the calendar year of the FYE. The `/download?inline`
suffix is constant.

**Year-discovery strategy:** today.year first, today.year - 1
fallback. Skip any year whose FYE is in the future. Same
implementation as NYSCRF.

**Quirks:** The query string `?inline` is part of the canonical URL
and required. Stripping it returns a different (login-gated)
response. The adapter's URL must include it verbatim.

#### 7. Ohio PERS

- **Plan key:** `ohio_pers`
- **Manual fallback script:** `scripts/scrape-cafr-ohio-pers.ts`
- **Fiscal year end:** December 31 (Ohio PERS uses calendar-year FY)
- **File size:** 16.3 MB (FY2024 Annual Report, 250+ pages)
- **Latest known PDF (FY2024):** `https://www.opers.org/pubs-archive/financial/2024-OPERS-Annual-Report.pdf`

**URL pattern:**

```
https://www.opers.org/pubs-archive/financial/{YYYY}-OPERS-Annual-Report.pdf
```

`{YYYY}` is the calendar year of the FYE.

**Year-discovery strategy:** today.year first, today.year - 1
fallback. Publish lag is 3-4 months after Dec 31 FYE - so on
April 27 2026, FY2025 (FYE 2025-12-31) should be published; FY2026
hasn't ended. The future-FYE filter drops FY2026 cleanly; one
probe to FY2025 typically resolves.

**Quirks:** None notable. Stable URL pattern verified back to
FY2020 in the `pubs-archive/financial/` directory.

#### 8. PA PSERS

- **Plan key:** `pa_psers`
- **Manual fallback script:** `scripts/scrape-cafr-psers.ts`
- **Fiscal year end:** June 30
- **File size:** 1.9 MB, ~170 pages (FY2025)
- **Latest known PDF (FY2025):** `https://www.pa.gov/content/dam/copapwp-pagov/en/psers/documents/transparency/financial-reports/acfr/psers%20acfr%20fy2025.pdf`

**URL pattern:**

```
https://www.pa.gov/content/dam/copapwp-pagov/en/psers/documents/transparency/financial-reports/acfr/psers%20acfr%20fy{YYYY}.pdf
```

`{YYYY}` is the calendar year of the FYE. The `fy{YYYY}` token
uses lowercase `fy`.

**Year-discovery strategy:** today.year first, today.year - 1
fallback. Same as NYSCRF.

**Quirks:**

- URL-encoded spaces (`%20`) inside the filename. Don't double-
  encode when constructing the URL.
- `pa.gov` uses a `/content/dam/copapwp-pagov/...` CMS path that
  has been stable for at least 3 fiscal years.

#### 9. LACERA

- **Plan key:** `lacera`
- **Manual fallback script:** `scripts/scrape-cafr-lacera.ts`
- **Fiscal year end:** June 30
- **File size:** 12.8 MB (FY2025). Comfortably under the 32 MB inline
  ceiling.
- **Latest known PDF (FY2025):** `https://www.lacera.gov/sites/default/files/assets/documents/annual_reports/ACFR-2025.pdf`

**URL pattern:**

```
https://www.lacera.gov/sites/default/files/assets/documents/annual_reports/ACFR-{YYYY}.pdf
```

`{YYYY}` is the calendar year of the FYE.

**Year-discovery strategy:** today.year first, today.year - 1
fallback. Same as NYSCRF.

**Quirks:** None notable. Stable Drupal `/sites/default/files/...`
path. The board-minutes scraper at `lib/scrapers/lacera.ts` covers
commitment signals; this adapter only handles the annual ACFR.

#### 10. Oregon PERS

- **Plan key:** `oregon_pers`
- **Manual fallback script:** `scripts/scrape-cafr-oregon.ts`
- **Fiscal year end:** June 30
- **File size:** 6.9 MB, 198 pages (FY2025)
- **Latest known PDF (FY2025):** `https://www.oregon.gov/pers/Documents/Financials/ACFR/2025-ACFR.pdf`

**URL pattern:**

```
https://www.oregon.gov/pers/Documents/Financials/ACFR/{YYYY}-ACFR.pdf
```

`{YYYY}` is the calendar year of the FYE.

**Year-discovery strategy:** today.year first, today.year - 1
fallback. Same as NYSCRF.

**Quirks:** Path uses initial-capital `Documents/Financials/ACFR/`
(not all-lowercase). State of Oregon CMS preserves casing - must
match exactly. The board-minutes scraper at `lib/scrapers/oregon.ts`
covers commitment signals.

#### 11. VRS (Virginia Retirement System)

- **Plan key:** `vrs`
- **Manual fallback script:** `scripts/scrape-cafr-vrs.ts`
- **Fiscal year end:** June 30
- **File size:** 3.2 MB (FY2025)
- **Latest known PDF (FY2025):** `https://www.varetire.org/media/shared/pdf/publications/2025-annual-report.pdf`

**URL pattern:**

```
https://www.varetire.org/media/shared/pdf/publications/{YYYY}-annual-report.pdf
```

`{YYYY}` is the calendar year of the FYE.

**Year-discovery strategy:** today.year first, today.year - 1
fallback. Same as NYSCRF.

**Quirks:** Filename uses lowercase `annual-report` (not capital
or "ACFR"). Stable URL pattern verified across multiple FYs. The
board-minutes scraper at `lib/scrapers/vrs.ts` covers commitment
signals via the wave-2 fan-out.

### Group B - WordPress publish-folder + year-encoded filename (1 plan)

Same shape as Wave 1's MA PRIM: WordPress upload folder
(`{PUB_YYYY}/{PUB_MM}/`) plus year-encoded filename. The adapter
must probe a small set of likely publish months because the publish
folder is not derivable from FYE alone.

#### 12. Michigan SMRS (MPSERS ACFR)

- **Plan key:** `michigan` (existing per board-minutes scraper)
- **Manual fallback script:** `scripts/scrape-cafr-michigan-smrs.ts`
- **Fiscal year end:** September 30 (MPSERS state retirement system FY)
- **File size:** 1.3 MB (FY2024)
- **Latest known PDF (FY2024):** `https://audgen.michigan.gov/wp-content/uploads/2025/03/Fiscal-Year-2024-MPSERS-ACFR.pdf`

**URL pattern:**

```
https://audgen.michigan.gov/wp-content/uploads/{PUB_YYYY}/{PUB_MM}/Fiscal-Year-{FY_YYYY}-MPSERS-ACFR.pdf
```

Three components:

- `{FY_YYYY}` is the calendar year of the FYE.
- `{PUB_YYYY}/{PUB_MM}` is the WordPress publish folder, NOT
  derivable from FYE alone - must probe.

**Year-discovery strategy:**

Publish lag has been 5-6 months after the September-end FYE
(FY2024 ended 2024-09-30, published 2025-03 - ~6 months). Probe
order per `FY_YYYY`:

1. `({FY_YYYY+1}, "03")` - canonical based on history
2. `({FY_YYYY+1}, "02")` - earlier
3. `({FY_YYYY+1}, "04")` - later
4. `({FY_YYYY+1}, "01")` - much earlier
5. `({FY_YYYY+1}, "05")` - much later
6. `({FY_YYYY}, "12")` - very early

6 candidates per `FY_YYYY` × 2 `FY_YYYY`s (today.year, today.year - 1)
× future-FYE filter = 6-12 probes per run. On 2026-04-27, FY2026
has ended (Sep 30 2026 is in the future, so future-FYE filter drops
it), so the adapter emits 6 probes for FY2025.

**Quirks:**

- Pulled from `audgen.michigan.gov` (Office of Auditor General),
  not `www.michigan.gov`. The www host has an Akamai bot wall that
  blocks non-browser clients; audgen.michigan.gov serves the same
  audited document without the wall. The adapter must use the
  audgen host.
- "Michigan SMRS" is the umbrella retirement-systems pool. MPSERS
  (Public School Employees' Retirement System) is the largest plan
  in the pool by AUM and the one Michigan publishes a dedicated
  ACFR for. Other Michigan systems (SERS / SPRS) have their own
  ACFRs that we do not currently ingest. Adapter targets MPSERS.
- Filename uses hyphenated `Fiscal-Year-{FY_YYYY}-MPSERS-ACFR.pdf`
  format with hyphens between every word. Different convention
  from MA PRIM's `PRIT-Annual-Comprehensive-...` form.

### Group C - Quarterly snapshot date (2 plans)

Plans publishing quarterly investment reports (instead of or in
addition to annual ACFRs). The adapter emits candidates for the
most recent N quarters in newest-first order. The 24-month FYE
filter still applies - quarter-end dates are valid YYYY-MM-DD
values that work with the same logic.

The `fiscalYearEnd` field in the CafrCandidate type is overloaded
to "snapshot date" for these plans. Quarter-ends are 3/31, 6/30,
9/30, 12/31. The dispatcher and ingestCafr treat the field as a
generic as-of date, so no contract change is needed.

Per design decision: **stay weekly** at the heartbeat cadence.
6 days of max staleness on a quarterly publication is acceptable.
Probing more frequently for these two plans would add operational
complexity for marginal freshness gain.

#### 13. NCRS (North Carolina Retirement Systems)

- **Plan key:** `nc_retirement`
- **Manual fallback script:** `scripts/scrape-cafr-ncrs.ts` (use this).
  The older `scripts/scrape-cafr-nc-retirement.ts` targets a
  different source and is deprecated - it will be marked
  deprecated in a header comment as part of PR 3 Phase 2 but not
  deleted in this PR.
- **Snapshot cadence:** Quarterly (Q1 / Q2 / Q3 / Q4)
- **File size:** ~1-2 MB (Q3 2025 QIR)
- **Latest known PDF (Q3 2025):** `https://www.nctreasurer.gov/documents/files/imdiac/quarterly-investment-report-qir-2025q3/open`

**URL pattern:**

```
https://www.nctreasurer.gov/documents/files/imdiac/quarterly-investment-report-qir-{YYYY}q{N}/open
```

- `{YYYY}` is the calendar year.
- `{N}` is the quarter number (1, 2, 3, or 4).

**Year-discovery strategy:**

Emit candidates for the most-recent 4 calendar quarters in
newest-first order. Skip any quarter whose end-date is in the
future. Stop at first 200 + PDF.

On 2026-04-27, the candidate sequence is:

1. `{2026, q1}` - Q1 2026 (ended 2026-03-31)
2. `{2025, q4}` - Q4 2025 (ended 2025-12-31)
3. `{2025, q3}` - Q3 2025 (ended 2025-09-30, already ingested)
4. `{2025, q2}` - Q2 2025 (ended 2025-06-30)

4 candidates per run. Well within the 24-probe budget.

**Quirks:**

- Snapshot date format: quarter-end (Q1=Mar31, Q2=Jun30,
  Q3=Sep30, Q4=Dec31). Use the calendar-quarter end, not NCRS's
  fiscal-year boundary (NC fiscal year is July-June, but
  quarterly reports are calendar-quarter).
- The trailing `/open` is nctreasurer.gov's "view PDF" endpoint.
  Stripping it returns the document landing page (HTML), not the
  PDF. Must include `/open` verbatim.
- The file is served as `application/pdf` via the `/open` endpoint
  even though the URL has no `.pdf` extension. Adapter just emits
  the URL; the dispatcher's content-type check handles it.

#### 14. WSIB (Washington State Investment Board)

- **Plan key:** `wsib`
- **Manual fallback script:** `scripts/scrape-cafr-wsib.ts`
- **Snapshot cadence:** Quarterly
- **File size:** 0.84 MB (Q2 2025 QIR, 25 pp)
- **Latest known PDF (Q2 2025):** `https://www.sib.wa.gov/docs/reports/quarterly/qr063025.pdf`

**URL pattern:**

```
https://www.sib.wa.gov/docs/reports/quarterly/qr{MMDDYY}.pdf
```

`{MMDDYY}` is the quarter-end date encoded as 6 digits with
2-digit year. Quarter-ends:

- Q1 → MM=03, DD=31 → `033125` for Q1 2025
- Q2 → MM=06, DD=30 → `063025` for Q2 2025
- Q3 → MM=09, DD=30 → `093025` for Q3 2025
- Q4 → MM=12, DD=31 → `123125` for Q4 2025

**Year-discovery strategy:**

Same as NCRS - emit candidates for the most-recent 4 calendar
quarters in newest-first order. Skip any quarter whose end-date
is in the future. Stop at first 200 + PDF.

On 2026-04-27, candidate sequence is:

1. `qr033126.pdf` - Q1 2026 (ended 2026-03-31)
2. `qr123125.pdf` - Q4 2025 (ended 2025-12-31)
3. `qr093025.pdf` - Q3 2025 (ended 2025-09-30)
4. `qr063025.pdf` - Q2 2025 (ended 2025-06-30, already ingested)

4 candidates per run.

**Quirks:**

- 2-digit year encoding (`25`, `26`). Risk of Y2.1K rollover at
  year 2099. We have plenty of runway, so do not over-engineer
  for the rollover.
- `sib.wa.gov` (not the more common `wsib.wa.gov`) is the canonical
  host. The adapter's URL must use `sib.wa.gov`.
- The fiscalYearEnd field stores the quarter-end as YYYY-MM-DD
  (e.g. `"2025-06-30"`) for the documents row's `meeting_date`
  column, matching how the manual script writes it today.

### Wave 2a-specific design notes

1. **Quarterly cadence does not require new architecture.** The
   adapter contract (`candidateUrls(today: Date) -> CafrCandidate[]`)
   handles quarterly plans by emitting more candidates per run.
   The 24-month FYE filter, cap-1 per run, content-hash dedup, and
   probe budget all work identically.

2. **`fiscalYearEnd` field overload.** For quarterly plans, the
   field stores the quarter-end date rather than the fiscal-year
   end. This is consistent with how the manual scripts already
   write the field for NCRS and WSIB. No schema change.

3. **NCRS legacy script deprecation.** PR 3 Phase 2 will add a
   deprecated header comment to `scripts/scrape-cafr-nc-
   retirement.ts` pointing readers at `scripts/scrape-cafr-ncrs.ts`.
   Removal of the legacy script is deferred to a future cleanup PR.

4. **Michigan SMRS host quirk.** The `audgen.michigan.gov` host is
   the only one of the 9 Wave 2a plans that uses a non-canonical
   primary domain. Worth noting in the adapter's docstring so
   future maintainers don't "fix" the URL by changing the host to
   `www.michigan.gov`, which is bot-walled.

5. **NCRS / WSIB quiet-dedupe behavior under cap-1.** Quarterly
   adapters emit 4 candidates per run, ordered newest-first. On
   most weeks, the first 200 + PDF will be a quarter we already
   have in storage; ingestCafr's content-hash dedup skips the
   insert and the cap-1 rule stops further probing. This is
   correct behavior, not a failure. PR 4's alerting layer must
   distinguish three outcomes per adapter run:
   - **Found new PDF, ingested** -> notify in the digest.
   - **Found existing PDF, deduped via content-hash** -> silent.
     This is the typical week for NCRS / WSIB.
   - **All probes failed (HTTP 5xx, non-PDF, network error)** ->
     count toward the failure-escalation ladder (1st normal,
     2nd HIGH PRIORITY, 3rd writes to broken_adapters log).

   "All probes returned 200 + PDF that we already had" is NOT a
   failure for these plans. The dispatcher needs to track ingest
   outcome (inserted vs skipped vs error) separately from probe
   outcome (200 vs 404 vs error).

## Cross-cutting design notes for PR 2 Phase 2

1. **Adapter signature.** Settle on a single shape, e.g.

   ```ts
   export type CafrAdapter = {
     planKey: string;
     fyeMonthDay: { month: number; day: number }; // e.g. { month: 6, day: 30 }
     candidateUrls(today: Date): Array<{
       url: string;
       fiscalYearEnd: string; // YYYY-MM-DD
     }>;
   };
   ```

   The heartbeat iterates `candidateUrls(today)`, applies the
   24-month filter to each candidate's `fiscalYearEnd`, takes the
   first 200 + PDF, and hands off to `ingestCafr()`.

2. **Heartbeat URL tightening.** Three of the five Wave 1 plans
   (MSBI, NJ DOI, MA PRIM) currently have bare-domain heartbeat
   URLs that will hash-flip on unrelated homepage edits. Phase 2
   should probe the right CAFR-archive subpath for each, verify
   it returns 200 + HTML, and update `scrape_config.website` via
   a small migration. Suggested candidates:

   - MSBI: `https://www.msbi.us/board/publications`
   - NJ DOI: `https://www.nj.gov/treasury/doinvest/publications/`
   - MA PRIM: `https://www.mapension.com/publications/annual-reports/`

   These are guesses; verify before applying.

3. **No-new-file is success, not failure.** As noted in NJ DOI's
   section, the failure escalation ladder must distinguish
   "exhausted all candidates, none returned a PDF" (legitimate -
   plan hasn't published yet) from "candidates returned HTTP 5xx
   or non-PDF content-type" (real failure). Only the latter
   counts toward the 1st-2nd-3rd ladder.

4. **Probe budget enforcement.** A bug in the candidate list
   (infinite loop, wrong month range) shouldn't melt the cron.
   Hard cap probes at 24 per plan per run; log and abort the
   adapter cleanly if hit.

5. **Dry-run step (between PR 3 and PR 4).** Before the heartbeat
   actually inserts via `ingestCafr`, run each adapter in
   probe-only mode against today's date and log which URL it
   would hit + which fiscal year that represents. Catches
   off-by-one year errors and bad URL templates before they
   cost API tokens.

## Open questions for Phase 2

- Confirm `scrape_config.key` value for TRS Illinois. The manual
  script uses `name='TRS Illinois'` lookup; the seed migration
  may not have set the key in the same form Phase 2 needs.
- Verify MSBI / MA PRIM / NJ DOI have a usable narrower CAFR-
  archive URL that returns a stable HTML index. If a plan only
  exposes its CAFRs via JS-rendered listing pages, the heartbeat
  alternative is to hash the CAFR PDF directory listing
  (`/wp-content/uploads/2025/12/` etc), which is more involved.
- Decide whether Phase 2 also writes a small migration to set a
  `scrape_config.cafr_adapter` flag per plan, distinguishing
  "auto-ingest via the Wave 1 adapter" from "manual_only" /
  "Wave 2 HTML scrape adapter". Cleanest dispatcher signature.
