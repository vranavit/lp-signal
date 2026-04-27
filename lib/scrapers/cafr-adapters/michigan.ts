import type { CafrAdapter, CafrCandidate } from "./types";
import { isFyePast } from "./utils";

/**
 * Michigan SMRS - State of Michigan Retirement Systems (MPSERS ACFR).
 *
 * URL pattern:
 *   https://audgen.michigan.gov/wp-content/uploads/{PUB_YYYY}/{PUB_MM}/Fiscal-Year-{FY_YYYY}-MPSERS-ACFR.pdf
 *
 * Three components:
 *   - {FY_YYYY}: calendar year of the FYE. Michigan SMRS / MPSERS
 *     fiscal year ends September 30, so FY2024 = FYE 2024-09-30.
 *   - {PUB_YYYY}/{PUB_MM}: WordPress upload folder. NOT derivable
 *     from FYE alone - must probe. Historical evidence (FY2024
 *     published 2025-03, ~6 months after the September FYE) clusters
 *     the publish month around Feb-Apr of FY+1 calendar year.
 *
 * IMPORTANT host quirk: pulled from audgen.michigan.gov (Office of
 * Auditor General), not www.michigan.gov. The www host has an Akamai
 * bot wall that blocks non-browser clients with HTTP 403; audgen
 * serves the same audited document without the wall. Do NOT "fix"
 * the URL by changing the host - it will break.
 *
 * Year-discovery: probe today.year, today.year - 1, today.year - 2 in
 * newest-first order. Skip any FY whose FYE is still in the future.
 * Per FY, 6 publish-month candidates ordered by historical likelihood.
 * The 3-FY fallback is load-bearing for Michigan SMRS specifically:
 * the September 30 FYE means the future-FYE filter drops today.year
 * for ~6 months of each calendar year, and today.year - 1's publish
 * (typical 5-6 month lag) sometimes slips past April. Without the
 * today.year - 2 fallback the adapter would return empty during that
 * window even though FY2024 is published and reachable.
 *
 * "Michigan SMRS" is the umbrella retirement-systems pool. MPSERS
 * (Public School Employees' Retirement System) is the largest plan
 * in the pool by AUM and the one Michigan publishes a dedicated
 * ACFR for. Other Michigan systems (SERS / SPRS) have separate
 * ACFRs that we do not currently ingest.
 *
 * Pattern reference: scripts/scrape-cafr-michigan-smrs.ts.
 */

function fyeFor(year: number): string {
  return `${year}-09-30`;
}

// Each entry is (PUB_YYYY offset from FY_YYYY, PUB_MM). Ordered by
// historical likelihood - February-March of FY+1 is canonical based
// on the FY2024 -> 2025-03 publish observed in the manual script.
const PUBLISH_CANDIDATES: ReadonlyArray<readonly [number, string]> = [
  [1, "03"],
  [1, "02"],
  [1, "04"],
  [1, "01"],
  [1, "05"],
  [0, "12"],
];

export const michiganAdapter: CafrAdapter = {
  planKey: "michigan",
  candidateUrls(today: Date): CafrCandidate[] {
    const y = today.getUTCFullYear();
    const out: CafrCandidate[] = [];
    for (const fyYyyy of [y, y - 1, y - 2]) {
      const fiscalYearEnd = fyeFor(fyYyyy);
      if (!isFyePast(fiscalYearEnd, today)) continue;
      for (const [yearOffset, pubMm] of PUBLISH_CANDIDATES) {
        const pubYyyy = fyYyyy + yearOffset;
        out.push({
          url: `https://audgen.michigan.gov/wp-content/uploads/${pubYyyy}/${pubMm}/Fiscal-Year-${fyYyyy}-MPSERS-ACFR.pdf`,
          fiscalYearEnd,
        });
      }
    }
    return out;
  },
};
