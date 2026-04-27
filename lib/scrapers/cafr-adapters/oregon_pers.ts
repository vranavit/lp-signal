import type { CafrAdapter, CafrCandidate } from "./types";
import { isFyePast } from "./utils";

/**
 * Oregon PERS (Oregon Public Employees Retirement System).
 *
 * URL pattern:
 *   https://www.oregon.gov/pers/Documents/Financials/ACFR/{YYYY}-ACFR.pdf
 *
 * {YYYY} is the calendar year of the FYE (FYE = June 30). The path
 * uses initial-capital "Documents/Financials/ACFR/" - the State of
 * Oregon CMS preserves casing, must match exactly.
 *
 * Year-discovery: probe today.year, today.year - 1, today.year - 2 in
 * newest-first order. Skip any year whose FYE is in the future. The
 * 3-FY fallback (defensive, matches NJ DOI's pattern) handles weeks
 * where today.year - 1 hasn't published yet.
 *
 * The board-minutes scraper at lib/scrapers/oregon.ts covers
 * commitment signals. This adapter only handles the annual ACFR.
 *
 * Pattern reference: scripts/scrape-cafr-oregon.ts.
 */

function fyeFor(year: number): string {
  return `${year}-06-30`;
}

export const oregonPersAdapter: CafrAdapter = {
  planKey: "oregon_pers",
  candidateUrls(today: Date): CafrCandidate[] {
    const y = today.getUTCFullYear();
    const out: CafrCandidate[] = [];
    for (const yyyy of [y, y - 1, y - 2]) {
      const fiscalYearEnd = fyeFor(yyyy);
      if (!isFyePast(fiscalYearEnd, today)) continue;
      out.push({
        url: `https://www.oregon.gov/pers/Documents/Financials/ACFR/${yyyy}-ACFR.pdf`,
        fiscalYearEnd,
      });
    }
    return out;
  },
};
