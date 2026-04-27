import type { CafrAdapter, CafrCandidate } from "./types";
import { recentPastQuarterEnds } from "./utils";

/**
 * NCRS (North Carolina Retirement Systems) - Quarterly Investment Report.
 *
 * URL pattern:
 *   https://www.nctreasurer.gov/documents/files/imdiac/quarterly-investment-report-qir-{YYYY}q{N}/open
 *
 * - {YYYY} is the calendar year of the snapshot quarter.
 * - {N} is the quarter number (1-4).
 * - The trailing "/open" is the nctreasurer.gov "view PDF" endpoint;
 *   stripping it returns an HTML landing page, not the PDF. Required.
 *
 * Cadence: quarterly. The adapter emits the 4 most-recent past quarter-
 * ends in newest-first order. Under cap-1, the first 200 + PDF wins;
 * already-ingested quarters are skipped via ingestCafr's content-hash
 * dedup. The fiscalYearEnd field is overloaded to "snapshot date"
 * (quarter-end YYYY-MM-DD) for the documents row.
 *
 * NC fiscal year is July-June, but quarterly reports use calendar
 * quarters. The QIR pattern below is calendar-quarter regardless of
 * NC's FY boundary.
 *
 * Pattern reference: scripts/scrape-cafr-ncrs.ts. The legacy
 * scripts/scrape-cafr-nc-retirement.ts targets a different (random
 * media-id) URL and is deprecated.
 */

const QUARTER_CANDIDATE_COUNT = 4;

export const ncRetirementAdapter: CafrAdapter = {
  planKey: "nc_retirement",
  candidateUrls(today: Date): CafrCandidate[] {
    return recentPastQuarterEnds(today, QUARTER_CANDIDATE_COUNT).map(
      (qe): CafrCandidate => ({
        url: `https://www.nctreasurer.gov/documents/files/imdiac/quarterly-investment-report-qir-${qe.year}q${qe.quarter}/open`,
        fiscalYearEnd: qe.date,
      }),
    );
  },
};
