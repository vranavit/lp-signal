import type { CafrAdapter, CafrCandidate } from "./types";
import { isFyePast } from "./utils";

/**
 * NJ DOI (New Jersey Division of Investment) — SIC Annual Report.
 *
 * URL pattern:
 *   https://www.nj.gov/treasury/doinvest/pdf/AnnualReport/AnnualReportforFiscalYear{YYYY}.pdf
 *
 * {YYYY} is the calendar year of the FYE (FYE = June 30).
 *
 * Year-discovery: NJ DOI's historical publish lag is 12-18 months — much
 * longer than the other Wave 1 plans. The most-likely-fresh FY is
 * today.year - 1 (the FY that ended a year+ ago and has had time to
 * publish), with today.year - 2 as the "definitely published" fallback
 * and today.year as a low-probability early-publish case. The cap-1 rule
 * means newer-first ordering is critical — if we probed today.year - 2
 * first, we'd hit the already-known FY and stop before checking for a
 * fresh release.
 *
 * Skip any year whose FYE is still in the future.
 *
 * Pattern reference: scripts/scrape-cafr-nj-doi.ts.
 */

function fyeFor(year: number): string {
  return `${year}-06-30`;
}

export const njDoiAdapter: CafrAdapter = {
  planKey: "nj_doi",
  candidateUrls(today: Date): CafrCandidate[] {
    const y = today.getUTCFullYear();
    const out: CafrCandidate[] = [];
    for (const yyyy of [y - 1, y - 2, y]) {
      const fiscalYearEnd = fyeFor(yyyy);
      if (!isFyePast(fiscalYearEnd, today)) continue;
      out.push({
        url: `https://www.nj.gov/treasury/doinvest/pdf/AnnualReport/AnnualReportforFiscalYear${yyyy}.pdf`,
        fiscalYearEnd,
      });
    }
    return out;
  },
};
