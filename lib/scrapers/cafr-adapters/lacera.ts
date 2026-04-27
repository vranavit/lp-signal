import type { CafrAdapter, CafrCandidate } from "./types";
import { isFyePast } from "./utils";

/**
 * LACERA (Los Angeles County Employees Retirement Association).
 *
 * URL pattern:
 *   https://www.lacera.gov/sites/default/files/assets/documents/annual_reports/ACFR-{YYYY}.pdf
 *
 * {YYYY} is the calendar year of the FYE (FYE = June 30).
 *
 * Year-discovery: probe today.year, today.year - 1, today.year - 2 in
 * newest-first order. Skip any year whose FYE is in the future. The
 * 3-FY fallback (defensive, matches NJ DOI's pattern) handles weeks
 * where today.year - 1 hasn't published yet.
 *
 * The board-minutes scraper at lib/scrapers/lacera.ts covers
 * commitment signals via the wave-2 fan-out cron. This adapter only
 * handles the annual ACFR.
 *
 * Pattern reference: scripts/scrape-cafr-lacera.ts.
 */

function fyeFor(year: number): string {
  return `${year}-06-30`;
}

export const laceraAdapter: CafrAdapter = {
  planKey: "lacera",
  candidateUrls(today: Date): CafrCandidate[] {
    const y = today.getUTCFullYear();
    const out: CafrCandidate[] = [];
    for (const yyyy of [y, y - 1, y - 2]) {
      const fiscalYearEnd = fyeFor(yyyy);
      if (!isFyePast(fiscalYearEnd, today)) continue;
      out.push({
        url: `https://www.lacera.gov/sites/default/files/assets/documents/annual_reports/ACFR-${yyyy}.pdf`,
        fiscalYearEnd,
      });
    }
    return out;
  },
};
