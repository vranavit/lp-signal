import type { CafrAdapter, CafrCandidate } from "./types";
import { isFyePast } from "./utils";

/**
 * Minnesota SBI — State Board of Investment Annual Report.
 *
 * URL pattern:
 *   https://www.msbi.us/sites/default/files/{PUB_YYYY}-{PUB_MM}/{FY_YYYY}%20MSBI%20Annual%20Report.pdf
 *
 * Three date components:
 *   - {FY_YYYY}: calendar year of the FYE (FYE = June 30).
 *   - {PUB_YYYY}-{PUB_MM}: Drupal upload-month folder. NOT derivable from
 *     FYE alone — must probe. Historical evidence from
 *     msbi.us/annual-reports (FY2025 → 2026-03, FY2024 → 2025-02,
 *     FY2023 → 2024-03) clusters publishes around Feb-Mar of FY+1.
 *
 * Year-discovery: probe today.year first, today.year - 1 fallback. Skip
 * any FY whose FYE is still in the future. Per FY, 6 publish-month
 * candidates ordered by historical likelihood. Filename uses URL-encoded
 * space ("%20").
 *
 * Pattern reference: scripts/scrape-cafr-minnesota-sbi.ts.
 */

function fyeFor(year: number): string {
  return `${year}-06-30`;
}

// Each entry is (PUB_YYYY offset from FY_YYYY, PUB_MM). Ordered by
// historical likelihood — Feb-Mar of FY+1 is canonical.
const PUBLISH_CANDIDATES: ReadonlyArray<readonly [number, string]> = [
  [1, "03"],
  [1, "02"],
  [1, "04"],
  [1, "01"],
  [0, "12"],
  [1, "05"],
];

export const minnesotaSbiAdapter: CafrAdapter = {
  planKey: "minnesota_sbi",
  candidateUrls(today: Date): CafrCandidate[] {
    const y = today.getUTCFullYear();
    const out: CafrCandidate[] = [];
    for (const fyYyyy of [y, y - 1]) {
      const fiscalYearEnd = fyeFor(fyYyyy);
      if (!isFyePast(fiscalYearEnd, today)) continue;
      for (const [yearOffset, pubMm] of PUBLISH_CANDIDATES) {
        const pubYyyy = fyYyyy + yearOffset;
        out.push({
          url: `https://www.msbi.us/sites/default/files/${pubYyyy}-${pubMm}/${fyYyyy}%20MSBI%20Annual%20Report.pdf`,
          fiscalYearEnd,
        });
      }
    }
    return out;
  },
};
