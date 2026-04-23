"use client";

import { tierFor, type ConfidenceTier } from "@/components/filters/filter-state";

// 3-state pill. Logic matches the filter-tier definition so pill +
// confidence filter always agree. Small, non-disruptive alongside table rows.

const TIER_CLASS: Record<ConfidenceTier, string> = {
  accepted:
    "bg-emerald-100 text-emerald-800 border-emerald-200",
  preliminary:
    "bg-amber-100 text-amber-800 border-amber-200",
  review:
    "bg-neutral-100 text-neutral-700 border-neutral-200",
};

const TIER_LABEL: Record<ConfidenceTier, string> = {
  accepted: "Accepted",
  preliminary: "Preliminary",
  review: "Review",
};

export function ConfidenceBadge({
  confidence,
  priority,
  preliminary,
  compact = false,
}: {
  confidence: number;
  priority: number;
  preliminary: boolean;
  compact?: boolean;
}) {
  const tier = tierFor(confidence, priority, preliminary);
  return (
    <span
      title={`confidence ${confidence.toFixed(2)} · priority ${priority}${preliminary ? " · flagged preliminary" : ""}`}
      className={
        "inline-flex items-center gap-1 rounded-sm border text-[10.5px] font-medium " +
        (compact ? "h-4 px-1" : "h-5 px-1.5") +
        " " +
        TIER_CLASS[tier]
      }
    >
      <span
        aria-hidden
        className={
          "inline-block h-1.5 w-1.5 rounded-full " +
          (tier === "accepted"
            ? "bg-emerald-600"
            : tier === "preliminary"
            ? "bg-amber-500"
            : "bg-neutral-400")
        }
      />
      {TIER_LABEL[tier]}
    </span>
  );
}
