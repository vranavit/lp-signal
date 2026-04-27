/**
 * Shared helpers for the Wave 1 (and beyond) CAFR adapters.
 */

/** True when the fiscal year end (YYYY-MM-DD) has already occurred at today. */
export function isFyePast(fiscalYearEnd: string, today: Date): boolean {
  return new Date(`${fiscalYearEnd}T00:00:00Z`).getTime() <= today.getTime();
}
