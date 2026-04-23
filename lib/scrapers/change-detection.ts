import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Change detection for continuous re-scraping.
 *
 * Every scraping cron fingerprints its source so /admin/ingestion and the
 * scraper-health-check cron can tell when a source has gone silent. The
 * fingerprint is cheap — SHA-256 of whatever the scraper uses as its
 * canonical "has the source moved?" signal (index HTML, discovered URL
 * list, monthly report filename, etc.).
 *
 * Rows live in `public.scrape_fingerprints`. Writes require the
 * service-role client (no RLS policies for authenticated users).
 *
 * Typical cron flow:
 *
 *   const body = await fetch(indexUrl).then(r => r.text());
 *   const hash = computeContentHash(body);
 *   const changed = await hasChanged(supabase, 'blackstone', hash);
 *   if (!changed) {
 *     await recordHash(supabase, 'blackstone', hash, { changed: false, ok: true, summary: 'no-op' });
 *     return { skipped: true };
 *   }
 *   // ... run the scraper ...
 *   await recordHash(supabase, 'blackstone', hash, { changed: true, ok: true, summary });
 */

export type FingerprintStatus = {
  sourceKey: string;
  lastHash: string | null;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  expectedCadenceHours: number;
  lastRunOk: boolean;
  lastRunSummary: string | null;
};

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function getFingerprint(
  supabase: SupabaseClient,
  sourceKey: string,
): Promise<FingerprintStatus | null> {
  const { data, error } = await supabase
    .from("scrape_fingerprints")
    .select(
      "source_key, last_hash, last_checked_at, last_changed_at, expected_cadence_hours, last_run_ok, last_run_summary",
    )
    .eq("source_key", sourceKey)
    .maybeSingle();
  if (error || !data) return null;
  return {
    sourceKey: data.source_key,
    lastHash: data.last_hash,
    lastCheckedAt: data.last_checked_at,
    lastChangedAt: data.last_changed_at,
    expectedCadenceHours: data.expected_cadence_hours,
    lastRunOk: data.last_run_ok,
    lastRunSummary: data.last_run_summary,
  };
}

export async function hasChanged(
  supabase: SupabaseClient,
  sourceKey: string,
  newHash: string,
): Promise<boolean> {
  const fp = await getFingerprint(supabase, sourceKey);
  if (!fp || !fp.lastHash) return true;
  return fp.lastHash !== newHash;
}

export type RecordHashInput = {
  hash: string | null;
  changed: boolean;
  ok: boolean;
  summary?: string | null;
  expectedCadenceHours?: number;
};

/**
 * Upsert a fingerprint row with the current timestamps.
 *
 * - `last_checked_at` always updates to now().
 * - `last_changed_at` updates only when `changed: true`.
 * - `last_hash` updates only when a hash is supplied AND `changed: true`
 *   (keeps the prior known-good hash if a run errored out before hashing).
 * - `last_run_ok` / `last_run_summary` always update.
 */
export async function recordHash(
  supabase: SupabaseClient,
  sourceKey: string,
  input: RecordHashInput,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getFingerprint(supabase, sourceKey);
  const payload: Record<string, unknown> = {
    source_key: sourceKey,
    last_checked_at: now,
    last_run_ok: input.ok,
    last_run_summary: input.summary ?? null,
  };
  if (typeof input.expectedCadenceHours === "number") {
    payload.expected_cadence_hours = input.expectedCadenceHours;
  }
  if (input.changed) {
    payload.last_changed_at = now;
    if (input.hash) payload.last_hash = input.hash;
  } else if (existing) {
    // Leave last_hash and last_changed_at untouched on unchanged runs.
    payload.last_hash = existing.lastHash;
    payload.last_changed_at = existing.lastChangedAt;
    if (!payload.expected_cadence_hours) {
      payload.expected_cadence_hours = existing.expectedCadenceHours;
    }
  } else {
    // First-time record with changed=false is unusual but harmless.
    if (input.hash) payload.last_hash = input.hash;
  }

  const { error } = await supabase
    .from("scrape_fingerprints")
    .upsert(payload, { onConflict: "source_key" });
  if (error) {
    throw new Error(`recordHash failed for ${sourceKey}: ${error.message}`);
  }
}
