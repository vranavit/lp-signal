import type { CafrAdapter, CafrCandidate } from "./types";
import { isFyePast } from "./utils";

/**
 * PA PSERS (Pennsylvania Public School Employees' Retirement System).
 *
 * URL pattern:
 *   https://www.pa.gov/content/dam/copapwp-pagov/en/psers/documents/transparency/financial-reports/acfr/psers%20acfr%20fy{YYYY}.pdf
 *
 * {YYYY} is the calendar year of the FYE (FYE = June 30). The
 * filename uses URL-encoded spaces (%20) and a lowercase `fy` prefix.
 *
 * Year-discovery: probe today.year, today.year - 1, today.year - 2 in
 * newest-first order. Skip any year whose FYE is in the future. The
 * 3-FY fallback (defensive, matches NJ DOI's pattern) handles weeks
 * where today.year - 1 hasn't published yet.
 *
 * Pattern reference: scripts/scrape-cafr-psers.ts.
 */

function fyeFor(year: number): string {
  return `${year}-06-30`;
}

export const paPsersAdapter: CafrAdapter = {
  planKey: "pa_psers",
  candidateUrls(today: Date): CafrCandidate[] {
    const y = today.getUTCFullYear();
    const out: CafrCandidate[] = [];
    for (const yyyy of [y, y - 1, y - 2]) {
      const fiscalYearEnd = fyeFor(yyyy);
      if (!isFyePast(fiscalYearEnd, today)) continue;
      out.push({
        url: `https://www.pa.gov/content/dam/copapwp-pagov/en/psers/documents/transparency/financial-reports/acfr/psers%20acfr%20fy${yyyy}.pdf`,
        fiscalYearEnd,
      });
    }
    return out;
  },
};
