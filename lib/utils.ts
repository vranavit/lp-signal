import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Single source of truth for USD display across table, detail panel, review
// cards. Precision matches the product spec:
//   >= $1B            → "$1.2B"   (1 decimal)
//   >= $10M           → "$500M" / "$25M"  (integer)
//   >= $1M            → "$8.5M"   (1 decimal for the $1–$10M band)
//   >= $1K            → "$500K"
//   else              → "$500"
// Negative values (e.g. T2 implied_delta_usd) keep the sign on the number.
export function formatUSD(amount: number | bigint | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "bigint" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 10_000_000) return `${sign}$${Math.round(abs / 1_000_000)}M`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

// 3-digit zero-padded score, e.g. 007 / 082 / 100.
export function formatPriorityScore(score: number): string {
  return Math.max(0, Math.min(999, Math.round(score)))
    .toString()
    .padStart(3, "0");
}

// Two-decimal confidence, e.g. 0.85.
export function formatConfidence(confidence: number): string {
  if (!Number.isFinite(confidence)) return "—";
  return confidence.toFixed(2);
}

const AMOUNT_KEYS = new Set([
  "amount_usd",
  "implied_delta_usd",
  "prior_year_pacing_usd",
  "new_year_pacing_usd",
  "commitment_amount_usd",
]);

// True for field keys whose integer value represents a USD amount and should
// be formatted with formatUSD rather than rendered as a raw integer.
export function isAmountKey(key: string): boolean {
  return AMOUNT_KEYS.has(key);
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

export function daysAgo(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}
