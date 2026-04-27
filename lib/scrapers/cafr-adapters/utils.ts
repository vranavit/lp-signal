/**
 * Shared helpers for the Wave 1 / 2a (and beyond) CAFR adapters.
 */

/** True when the fiscal year end (YYYY-MM-DD) has already occurred at today. */
export function isFyePast(fiscalYearEnd: string, today: Date): boolean {
  return new Date(`${fiscalYearEnd}T00:00:00Z`).getTime() <= today.getTime();
}

export type QuarterEnd = {
  year: number;
  quarter: number; // 1-4
  date: string; // YYYY-MM-DD
};

export function quarterEndDate(year: number, quarter: number): string {
  if (quarter === 1) return `${year}-03-31`;
  if (quarter === 2) return `${year}-06-30`;
  if (quarter === 3) return `${year}-09-30`;
  if (quarter === 4) return `${year}-12-31`;
  throw new Error(`invalid quarter ${quarter}`);
}

/**
 * Return the `count` most-recent calendar quarter-ends with date <= today,
 * newest first. Used by the quarterly-cadence Wave 2a adapters (NCRS, WSIB).
 */
export function recentPastQuarterEnds(today: Date, count: number): QuarterEnd[] {
  const m = today.getUTCMonth() + 1;
  const d = today.getUTCDate();
  let year = today.getUTCFullYear();
  let quarter: number;
  if (m === 12 && d >= 31) quarter = 4;
  else if (m > 9 || (m === 9 && d >= 30)) quarter = 3;
  else if (m > 6 || (m === 6 && d >= 30)) quarter = 2;
  else if (m > 3 || (m === 3 && d >= 31)) quarter = 1;
  else {
    quarter = 4;
    year -= 1;
  }
  const out: QuarterEnd[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ year, quarter, date: quarterEndDate(year, quarter) });
    if (quarter === 1) {
      quarter = 4;
      year -= 1;
    } else {
      quarter -= 1;
    }
  }
  return out;
}
