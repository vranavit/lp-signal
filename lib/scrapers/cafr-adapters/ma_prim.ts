import type { CafrAdapter, CafrCandidate } from "./types";
import { isFyePast } from "./utils";

/**
 * MA PRIM — Massachusetts Pension Reserves Investment Management Board.
 *
 * URL pattern:
 *   https://www.mapension.com/wp-content/uploads/{PUB_YYYY}/{PUB_MM}/PRIT-Annual-Comprehensive-Financial-Report-0630{FY_YYYY}.pdf
 *
 * Three date components:
 *   - {FY_YYYY}: calendar year of FYE (FYE = June 30).
 *   - "0630" is fixed (June 30 FYE encoded as MMDD inside the filename).
 *   - {PUB_YYYY}/{PUB_MM}: WordPress upload folder. NOT derivable from
 *     FYE alone — must probe. Historical evidence (FY2025 → 2025-12)
 *     puts publish in December of the same calendar year as FYE.
 *
 * Year-discovery: probe today.year first, today.year - 1 fallback. Skip
 * any FY whose FYE is still in the future. Per FY, 6 publish-month
 * candidates ordered by likelihood. The cap is 12 probes per run.
 *
 * Per design notes: do NOT probe legacy filename variants (e.g.
 * PRIT-ACFR-FY{YY}.pdf) on first run. If the canonical long form fails
 * for a fresh FY, surface as a "no new doc for 90+ days" alert and
 * extend the adapter manually rather than guessing.
 *
 * Pattern reference: scripts/scrape-cafr-ma-prim.ts.
 */

function fyeFor(year: number): string {
  return `${year}-06-30`;
}

// Each entry is (PUB_YYYY offset from FY_YYYY, PUB_MM). Ordered by
// historical likelihood — December of same calendar year as FYE is
// canonical.
const PUBLISH_CANDIDATES: ReadonlyArray<readonly [number, string]> = [
  [0, "12"],
  [1, "01"],
  [1, "02"],
  [0, "11"],
  [1, "03"],
  [0, "10"],
];

export const maPrimAdapter: CafrAdapter = {
  planKey: "ma_prim",
  candidateUrls(today: Date): CafrCandidate[] {
    const y = today.getUTCFullYear();
    const out: CafrCandidate[] = [];
    for (const fyYyyy of [y, y - 1]) {
      const fiscalYearEnd = fyeFor(fyYyyy);
      if (!isFyePast(fiscalYearEnd, today)) continue;
      for (const [yearOffset, pubMm] of PUBLISH_CANDIDATES) {
        const pubYyyy = fyYyyy + yearOffset;
        out.push({
          url: `https://www.mapension.com/wp-content/uploads/${pubYyyy}/${pubMm}/PRIT-Annual-Comprehensive-Financial-Report-0630${fyYyyy}.pdf`,
          fiscalYearEnd,
        });
      }
    }
    return out;
  },
};
