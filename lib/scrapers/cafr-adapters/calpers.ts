import type { CafrAdapter, CafrCandidate } from "./types";
import { isFyePast } from "./utils";

/**
 * CalPERS (California Public Employees' Retirement System).
 *
 * URL pattern:
 *   https://www.calpers.ca.gov/documents/acfr-{YYYY}/download?inline
 *
 * {YYYY} is the calendar year of the FYE (FYE = June 30). The
 * `?inline` query string is part of the canonical URL and required -
 * stripping it returns a different (login-gated) response. The adapter
 * must include it verbatim.
 *
 * Year-discovery: probe today.year, today.year - 1, today.year - 2 in
 * newest-first order. Skip any year whose FYE is in the future. The
 * 3-FY fallback (defensive, matches NJ DOI's pattern) handles weeks
 * where today.year - 1 hasn't published yet, ensuring the adapter
 * still hits the most-recent-published FY rather than returning empty.
 *
 * The FY2025 ACFR is 30.4 MB raw - base64 inflation pushes it past
 * the 32 MB inline ceiling. The existing Files API path (commit
 * 2dc1d09) routes oversized PDFs automatically via
 * insertOversizedCafrRow + classifyCafrFromBytes. The adapter only
 * emits the URL; size routing is a dispatcher / ingestCafr concern.
 *
 * Pattern reference: scripts/scrape-cafr-calpers.ts.
 */

function fyeFor(year: number): string {
  return `${year}-06-30`;
}

export const calpersAdapter: CafrAdapter = {
  planKey: "calpers",
  candidateUrls(today: Date): CafrCandidate[] {
    const y = today.getUTCFullYear();
    const out: CafrCandidate[] = [];
    for (const yyyy of [y, y - 1, y - 2]) {
      const fiscalYearEnd = fyeFor(yyyy);
      if (!isFyePast(fiscalYearEnd, today)) continue;
      out.push({
        url: `https://www.calpers.ca.gov/documents/acfr-${yyyy}/download?inline`,
        fiscalYearEnd,
      });
    }
    return out;
  },
};
