import type { CafrAdapter, CafrCandidate } from "./types";
import { isFyePast } from "./utils";

/**
 * NYSCRF (New York State Common Retirement Fund).
 *
 * URL pattern:
 *   https://www.osc.ny.gov/files/retirement/resources/pdf/annual-comprehensive-financial-report-{YYYY}.pdf
 *
 * {YYYY} is the calendar year of the FYE (FYE = March 31). Single year-
 * encoded URL with no publish-folder variation.
 *
 * Year-discovery: probe today.year first, today.year - 1 fallback. The
 * 7-9 month publish lag means today.year is often a 404 in early calendar
 * year, but ordering newest-first ensures the cap-1 rule never causes us
 * to miss a fresh ACFR. Skip any year whose FYE is still in the future.
 *
 * Pattern reference: scripts/scrape-cafr-nyscrf.ts.
 */

function fyeFor(year: number): string {
  return `${year}-03-31`;
}

export const nyscrfAdapter: CafrAdapter = {
  planKey: "nyscrf",
  candidateUrls(today: Date): CafrCandidate[] {
    const y = today.getUTCFullYear();
    const out: CafrCandidate[] = [];
    for (const yyyy of [y, y - 1]) {
      const fiscalYearEnd = fyeFor(yyyy);
      if (!isFyePast(fiscalYearEnd, today)) continue;
      out.push({
        url: `https://www.osc.ny.gov/files/retirement/resources/pdf/annual-comprehensive-financial-report-${yyyy}.pdf`,
        fiscalYearEnd,
      });
    }
    return out;
  },
};
