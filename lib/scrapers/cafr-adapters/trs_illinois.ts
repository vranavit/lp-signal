import type { CafrAdapter, CafrCandidate } from "./types";
import { isFyePast } from "./utils";

/**
 * TRS Illinois (Teachers' Retirement System of Illinois).
 *
 * URL pattern:
 *   https://www.trsil.org/sites/default/files/documents/ACFR-FY{YY}-web{SUFFIX}.pdf
 *
 * {YY} is the 2-digit calendar year of the FYE (FYE = June 30). {SUFFIX}
 * is one of "_0" / "" / "_1" — Drupal node-revision marks that appear
 * when the file is re-uploaded. Probe order is "_0" first (the canonical
 * "current revision" marker that the manual ingest scripts have been
 * pointing at), then "" (no suffix), then "_1". The "_0" / no-suffix
 * URLs may both be live concurrently for a given FY; probing "_0"
 * first and stopping at the first 200 + PDF avoids ingesting two
 * documents for the same fiscal year if they diverge.
 *
 * Year-discovery: probe today.year first, today.year - 1 fallback. Skip
 * any year whose FYE is still in the future.
 *
 * Pattern reference: scripts/scrape-cafr-illinois-trs.ts.
 */

const SUFFIXES = ["_0", "", "_1"] as const;

function fyeFor(year: number): string {
  return `${year}-06-30`;
}

export const trsIllinoisAdapter: CafrAdapter = {
  planKey: "trs_illinois",
  candidateUrls(today: Date): CafrCandidate[] {
    const y = today.getUTCFullYear();
    const out: CafrCandidate[] = [];
    for (const yyyy of [y, y - 1]) {
      const fiscalYearEnd = fyeFor(yyyy);
      if (!isFyePast(fiscalYearEnd, today)) continue;
      const yy = String(yyyy).slice(-2);
      for (const suffix of SUFFIXES) {
        out.push({
          url: `https://www.trsil.org/sites/default/files/documents/ACFR-FY${yy}-web${suffix}.pdf`,
          fiscalYearEnd,
        });
      }
    }
    return out;
  },
};
