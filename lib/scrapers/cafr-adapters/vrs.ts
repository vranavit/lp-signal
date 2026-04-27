import type { CafrAdapter, CafrCandidate } from "./types";
import { isFyePast } from "./utils";

/**
 * VRS (Virginia Retirement System).
 *
 * URL pattern:
 *   https://www.varetire.org/media/shared/pdf/publications/{YYYY}-annual-report.pdf
 *
 * {YYYY} is the calendar year of the FYE (FYE = June 30). Filename
 * uses lowercase `annual-report` (not `ACFR`).
 *
 * Year-discovery: probe today.year, today.year - 1, today.year - 2 in
 * newest-first order. Skip any year whose FYE is in the future. The
 * 3-FY fallback (defensive, matches NJ DOI's pattern) handles weeks
 * where today.year - 1 hasn't published yet.
 *
 * The board-minutes scraper at lib/scrapers/vrs.ts covers commitment
 * signals via the wave-2 fan-out cron. This adapter only handles the
 * annual report.
 *
 * Pattern reference: scripts/scrape-cafr-vrs.ts.
 */

function fyeFor(year: number): string {
  return `${year}-06-30`;
}

export const vrsAdapter: CafrAdapter = {
  planKey: "vrs",
  candidateUrls(today: Date): CafrCandidate[] {
    const y = today.getUTCFullYear();
    const out: CafrCandidate[] = [];
    for (const yyyy of [y, y - 1, y - 2]) {
      const fiscalYearEnd = fyeFor(yyyy);
      if (!isFyePast(fiscalYearEnd, today)) continue;
      out.push({
        url: `https://www.varetire.org/media/shared/pdf/publications/${yyyy}-annual-report.pdf`,
        fiscalYearEnd,
      });
    }
    return out;
  },
};
