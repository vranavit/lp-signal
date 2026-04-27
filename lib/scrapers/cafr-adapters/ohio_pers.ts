import type { CafrAdapter, CafrCandidate } from "./types";
import { isFyePast } from "./utils";

/**
 * Ohio PERS (Ohio Public Employees Retirement System).
 *
 * URL pattern:
 *   https://www.opers.org/pubs-archive/financial/{YYYY}-OPERS-Annual-Report.pdf
 *
 * {YYYY} is the calendar year of the FYE. Ohio PERS uses a calendar-
 * year fiscal year (FYE = December 31).
 *
 * Year-discovery: probe today.year, today.year - 1, today.year - 2 in
 * newest-first order. Skip any year whose FYE is in the future. The
 * 3-FY fallback is load-bearing for Ohio PERS specifically: the
 * Dec 31 FYE means the future-FYE filter drops today.year for ~9
 * months of each calendar year, and if today.year - 1's publication
 * is delayed (typical 3-4 month lag, but variable), today.year - 2
 * is the only candidate guaranteed to be published.
 *
 * Pattern reference: scripts/scrape-cafr-ohio-pers.ts.
 */

function fyeFor(year: number): string {
  return `${year}-12-31`;
}

export const ohioPersAdapter: CafrAdapter = {
  planKey: "ohio_pers",
  candidateUrls(today: Date): CafrCandidate[] {
    const y = today.getUTCFullYear();
    const out: CafrCandidate[] = [];
    for (const yyyy of [y, y - 1, y - 2]) {
      const fiscalYearEnd = fyeFor(yyyy);
      if (!isFyePast(fiscalYearEnd, today)) continue;
      out.push({
        url: `https://www.opers.org/pubs-archive/financial/${yyyy}-OPERS-Annual-Report.pdf`,
        fiscalYearEnd,
      });
    }
    return out;
  },
};
