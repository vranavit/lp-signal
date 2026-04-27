import type { CafrAdapter, CafrCandidate } from "./types";
import { recentPastQuarterEnds, type QuarterEnd } from "./utils";

/**
 * WSIB (Washington State Investment Board) - Quarterly Investment Report.
 *
 * URL pattern:
 *   https://www.sib.wa.gov/docs/reports/quarterly/qr{MMDDYY}.pdf
 *
 * {MMDDYY} is the quarter-end date encoded as 6 digits with 2-digit
 * year. Quarter-ends:
 *   - Q1 -> 0331{yy}
 *   - Q2 -> 0630{yy}
 *   - Q3 -> 0930{yy}
 *   - Q4 -> 1231{yy}
 *
 * Y2.1K rollover at year 2100: the 2-digit year (yy) collides with
 * 2000-2099. We have 73+ years of runway so this is not addressed
 * here, but flagged for future maintainers. When/if WSIB changes
 * the encoding, update this adapter.
 *
 * Cadence: quarterly. The adapter emits the 4 most-recent past
 * quarter-ends in newest-first order. Same shape as NCRS - cap-1
 * + content-hash dedup mean the first 200 + PDF wins, with already-
 * ingested quarters silently skipped.
 *
 * Host quirk: sib.wa.gov (no "w" prefix). www.wsib.wa.gov is NOT
 * the canonical domain.
 *
 * Pattern reference: scripts/scrape-cafr-wsib.ts.
 */

const QUARTER_CANDIDATE_COUNT = 4;

function wsibFilename(qe: QuarterEnd): string {
  const yy = String(qe.year).slice(-2);
  if (qe.quarter === 1) return `qr0331${yy}.pdf`;
  if (qe.quarter === 2) return `qr0630${yy}.pdf`;
  if (qe.quarter === 3) return `qr0930${yy}.pdf`;
  return `qr1231${yy}.pdf`;
}

export const wsibAdapter: CafrAdapter = {
  planKey: "wsib",
  candidateUrls(today: Date): CafrCandidate[] {
    return recentPastQuarterEnds(today, QUARTER_CANDIDATE_COUNT).map(
      (qe): CafrCandidate => ({
        url: `https://www.sib.wa.gov/docs/reports/quarterly/${wsibFilename(qe)}`,
        fiscalYearEnd: qe.date,
      }),
    );
  },
};
