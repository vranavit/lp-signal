/**
 * Contract for CAFR auto-ingest adapters.
 *
 * An adapter is a pure function from today's date to an ordered list of
 * candidate CAFR PDF URLs. The dispatcher iterates candidates, applies the
 * recency filter, probes each, and hands the first 200 + PDF response to
 * ingestCafr(). Stops at the first hit (cap-1 per run).
 *
 * Adapters do not track state, dedup, or consult prior runs — content-hash
 * dedup inside ingestCafr() handles re-fetches, and the dispatcher applies
 * all policy (recency, probe budget, failure escalation).
 */

export type CafrCandidate = {
  url: string;
  fiscalYearEnd: string; // YYYY-MM-DD
};

export type CafrAdapter = {
  /** Matches plans.scrape_config.key — registry uses this to resolve plan_id. */
  planKey: string;
  /**
   * Ordered by likelihood of being the freshest unseen CAFR. The dispatcher
   * probes in order and stops at the first hit. Must return at most
   * MAX_PROBES_PER_RUN candidates.
   */
  candidateUrls(today: Date): CafrCandidate[];
};

/**
 * Catches off-by-one-year adapter bugs without rejecting legitimately-late
 * publications. Some plans publish 12-18 months after FYE, so 24 leaves
 * margin without weakening the safety check.
 */
export const MAX_FYE_AGE_MONTHS = 24;

/** Hard cap on candidate URLs probed per adapter per heartbeat run. */
export const MAX_PROBES_PER_RUN = 24;

function subtractMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() - months);
  return result;
}

export function isFyeWithinRecencyWindow(
  fiscalYearEnd: string,
  today: Date,
  maxMonths: number = MAX_FYE_AGE_MONTHS,
): boolean {
  const fye = new Date(`${fiscalYearEnd}T00:00:00Z`);
  const cutoff = subtractMonths(today, maxMonths);
  return fye.getTime() >= cutoff.getTime();
}
