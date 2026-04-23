// Per-plan data-availability metadata used on /plans and /pensions/[slug].
// Keeps it in code (not DB) because the reasons are scraper-specific and
// we iterate faster on scraper state than schema. If the list grows past
// ~20 entries, promote to a data_availability_status column on plans.

export type AvailabilityStatus = "active" | "blocked" | "pending";

export type PlanAvailability = {
  status: AvailabilityStatus;
  label: string;
  reason?: string;
};

// Known scraper-blocked plans. Update alongside scripts/scrape-*.ts changes.
const KNOWN: Record<string, PlanAvailability> = {
  // Florida SBA — Akamai anti-bot on sbafla.com blocks the CAFR fetch.
  "Florida SBA": {
    status: "blocked",
    label: "Blocked by source",
    reason:
      "Source documents currently blocked by the plan website's anti-bot protection (Akamai). Seeking alternative ingestion path.",
  },
};

export function availabilityFor(planName: string): PlanAvailability {
  const known = KNOWN[planName];
  if (known) return known;
  return {
    status: "pending",
    label: "Pending ingestion",
    reason:
      "This plan is in the Allocus pipeline but hasn't been ingested yet. Check back soon.",
  };
}

export function isEmpty(counts: {
  signals: number;
  allocations: number;
  documents: number;
}): boolean {
  return (
    counts.signals === 0 && counts.allocations === 0 && counts.documents === 0
  );
}
