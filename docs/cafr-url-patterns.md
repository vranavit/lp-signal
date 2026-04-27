# CAFR URL patterns

Established 2026-04-27 as Phase 1 of PR 2 (Wave 1 adapters) under
sub-project B (CAFR auto-ingestion). One section per plan that the
weekly `/api/cron/scrape-cafr` heartbeat will auto-ingest, plus the
year-discovery strategy each adapter needs to implement.

PR 2 Phase 2 will turn each section here into a concrete TypeScript
adapter under `lib/scrapers/cafr-adapters/`.

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
- **15-month FYE recency filter.** Reject any candidate URL whose
  encoded fiscal-year-end is older than (today minus 15 months).
  Stops the adapter from happily re-ingesting a 2018 ACFR if the
  pattern accidentally matches.
- **Probe budget.** Cap candidate URL probes at 24 per plan per run.
  Most adapters will need 2 to 4; MSBI and MA PRIM (publish-month
  folders) need up to 24.
- **Failure escalation.** First failure on a plan: normal log entry.
  Second consecutive: HIGH PRIORITY in the digest. Third
  consecutive: write to the `broken_adapters` log and skip this
  plan on subsequent runs until manually re-enabled. (Implemented
  in PR 4, not PR 2.)

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

**Earliest acceptable FYE under the 15-month filter:**
`today() - 15 months`. On 2026-04-27 the cutoff is 2025-01-27, so
FY2025 (FYE 2025-03-31) is the earliest year that passes.

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

**Earliest acceptable FYE under the 15-month filter:**
On 2026-04-27 the cutoff is 2025-01-27. FY2024 (FYE 2024-06-30)
fails (older than the cutoff). FY2025 (2025-06-30) passes.

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

**Earliest acceptable FYE under the 15-month filter:** Same as
MSBI - on 2026-04-27, FY2025 passes, FY2024 fails.

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

**Earliest acceptable FYE under the 15-month filter:** Cutoff on
2026-04-27 is 2025-01-27. FY2024 (2024-06-30) fails the filter -
but it's already ingested, and the adapter's job is to pull
what's NEW, not re-ingest old. The 15-month filter is a
defense-in-depth check; the adapter will simply find no
qualifying URL on most runs until NJ DOI publishes FY2025.

This is the canonical case where "adapter found nothing" is the
correct outcome for many months.

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

**Earliest acceptable FYE under the 15-month filter:** On
2026-04-27 the cutoff is 2025-01-27. FY2025 (2025-06-30) passes;
FY2024 (2024-06-30) fails. FY2025 already ingested as of the
manual run, so first auto-ingest hit will be FY2026 around
Dec 2026.

---

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
   15-month filter to each candidate's `fiscalYearEnd`, takes the
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
