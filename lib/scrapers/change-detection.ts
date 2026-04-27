import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Change detection for continuous re-scraping.
 *
 * Every scraping cron fingerprints its source so /admin/ingestion and the
 * scraper-health-check cron can tell when a source has gone silent. The
 * fingerprint is cheap - SHA-256 of whatever the scraper uses as its
 * canonical "has the source moved?" signal (index HTML, discovered URL
 * list, monthly report filename, etc.).
 *
 * Rows live in `public.scrape_fingerprints`. Writes require the
 * service-role client (no RLS policies for authenticated users).
 *
 * PR 4 (sub-project B) added the dispatcher columns
 * (consecutive_failures, quarantined_at, last_outcome_kind) and the
 * outcome-driven `recordOutcome` helper. Existing scrapers that call
 * `recordHash` continue to work unchanged - the new columns stay at
 * their defaults for those rows.
 *
 * Typical non-CAFR cron flow (unchanged):
 *
 *   const body = await fetch(indexUrl).then(r => r.text());
 *   const hash = computeContentHash(body);
 *   const changed = await hasChanged(supabase, 'blackstone', hash);
 *   if (!changed) {
 *     await recordHash(supabase, 'blackstone', { hash, changed: false, ok: true, summary: 'no-op' });
 *     return { skipped: true };
 *   }
 *   // ... run the scraper ...
 *   await recordHash(supabase, 'blackstone', { hash, changed: true, ok: true, summary });
 *
 * CAFR dispatcher flow (PR 4):
 *
 *   const outcome = await probePlan(plan, adapter, today, supabase);
 *   const { fingerprint, newlyQuarantined } = await recordOutcome(
 *     supabase, `cafr-${planKey}`, outcome, 7 * 24
 *   );
 */

/**
 * The 5 dispatcher outcomes. Matches the CHECK constraint on
 * scrape_fingerprints.last_outcome_kind. camelCase to match the TS
 * Outcome.kind field directly with no mapper.
 */
export type OutcomeKind =
  | "ingested"
  | "deduped"
  | "empty"
  | "sourceFailure"
  | "infraFailure";

/**
 * Discriminated union returned from the dispatcher's probePlan and
 * consumed by recordOutcome. Each variant carries the fields needed to
 * build the fingerprint summary and digest payload for that outcome.
 */
export type Outcome =
  | {
      kind: "ingested";
      url: string;
      fye: string;
      sizeBytes: number;
      documentId?: string;
    }
  | {
      kind: "deduped";
      url: string;
      fye: string;
      documentId?: string;
    }
  | {
      kind: "empty";
      newestProbedUrl: string | null;
    }
  | {
      kind: "sourceFailure";
      lastError: string;
    }
  | {
      kind: "infraFailure";
      url: string;
      error: string;
    };

export type FingerprintStatus = {
  sourceKey: string;
  lastHash: string | null;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  expectedCadenceHours: number;
  lastRunOk: boolean;
  lastRunSummary: string | null;
  // PR 4 dispatcher columns:
  consecutiveFailures: number;
  quarantinedAt: string | null;
  lastOutcomeKind: OutcomeKind | null;
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
      "source_key, last_hash, last_checked_at, last_changed_at, expected_cadence_hours, last_run_ok, last_run_summary, consecutive_failures, quarantined_at, last_outcome_kind",
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
    consecutiveFailures: data.consecutive_failures ?? 0,
    quarantinedAt: data.quarantined_at,
    lastOutcomeKind: data.last_outcome_kind as OutcomeKind | null,
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
  // PR 4 dispatcher additions. All optional; undefined leaves the
  // corresponding column at its existing value. `null` on quarantinedAt
  // explicitly clears the lock.
  consecutiveFailures?: number;
  quarantinedAt?: string | null;
  lastOutcomeKind?: OutcomeKind;
};

/**
 * Upsert a fingerprint row with the current timestamps.
 *
 * - `last_checked_at` always updates to now().
 * - `last_changed_at` updates only when `changed: true`.
 * - `last_hash` updates only when a hash is supplied AND `changed: true`
 *   (keeps the prior known-good hash if a run errored out before hashing).
 * - `last_run_ok` / `last_run_summary` always update.
 * - PR 4 columns (consecutive_failures / quarantined_at / last_outcome_kind)
 *   update only when the caller supplies a value. Existing scrapers that
 *   don't pass these fields leave the columns at their defaults.
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
  // PR 4 columns: only write when caller supplied a value.
  if (input.consecutiveFailures !== undefined) {
    payload.consecutive_failures = input.consecutiveFailures;
  }
  if (input.quarantinedAt !== undefined) {
    payload.quarantined_at = input.quarantinedAt;
  }
  if (input.lastOutcomeKind !== undefined) {
    payload.last_outcome_kind = input.lastOutcomeKind;
  }

  const { error } = await supabase
    .from("scrape_fingerprints")
    .upsert(payload, { onConflict: "source_key" });
  if (error) {
    throw new Error(`recordHash failed for ${sourceKey}: ${error.message}`);
  }
}

export type RecordOutcomeResult = {
  fingerprint: FingerprintStatus;
  newlyQuarantined: boolean;
};

/**
 * Outcome-driven fingerprint update for the CAFR dispatcher (PR 4).
 *
 * Reads the current fingerprint once (needed for the consecutive-failures
 * increment + newly-quarantined detection), computes the new column
 * values per the 5-outcome state machine, calls recordHash, and returns
 * the post-write FingerprintStatus inline (no second DB read).
 *
 * Outcome -> fingerprint state:
 *
 * | kind          | last_run_ok | hash          | changed | counter   | quarantined_at        |
 * |---------------|-------------|---------------|---------|-----------|-----------------------|
 * | ingested      | true        | URL+FYE hash  | true    | reset 0   | preserved             |
 * | deduped       | true        | null          | false   | reset 0   | preserved             |
 * | empty         | true        | null          | false   | reset 0   | preserved             |
 * | sourceFailure | false       | null          | false   | +1        | now() if reaches 3    |
 * | infraFailure  | false       | null          | false   | preserved | preserved             |
 *
 * `infraFailure` does not increment because the source returned a valid
 * PDF; the failure is on Allocus infrastructure (Supabase Storage upload,
 * etc.) - blame doesn't belong on the source-side escalation ladder.
 *
 * `newlyQuarantined: true` only fires on the specific call that
 * transitions quarantined_at from null to a timestamp. Subsequent
 * sourceFailure calls while already quarantined return false.
 */
export async function recordOutcome(
  supabase: SupabaseClient,
  sourceKey: string,
  outcome: Outcome,
  expectedCadenceHours?: number,
): Promise<RecordOutcomeResult> {
  const now = new Date().toISOString();
  const existing = await getFingerprint(supabase, sourceKey);
  const priorConsecutive = existing?.consecutiveFailures ?? 0;
  const priorQuarantinedAt = existing?.quarantinedAt ?? null;
  const priorLastHash = existing?.lastHash ?? null;
  const priorLastChangedAt = existing?.lastChangedAt ?? null;
  const priorCadence = existing?.expectedCadenceHours ?? 24;

  let summary: string;
  let ok: boolean;
  let changed: boolean;
  let hash: string | null;
  let nextConsecutive: number | undefined;
  let nextQuarantinedAt: string | null | undefined;
  let lastOutcomeKind: OutcomeKind;
  let newlyQuarantined = false;

  switch (outcome.kind) {
    case "ingested": {
      const sizeMb = (outcome.sizeBytes / 1024 / 1024).toFixed(2);
      summary = `Ingested FY${outcome.fye} (${sizeMb} MB): ${outcome.url}`;
      ok = true;
      changed = true;
      hash = computeContentHash(`${outcome.url}|${outcome.fye}`);
      nextConsecutive = 0;
      lastOutcomeKind = "ingested";
      break;
    }
    case "deduped": {
      summary = `Deduped FY${outcome.fye}: ${outcome.url}`;
      ok = true;
      changed = false;
      hash = null;
      nextConsecutive = 0;
      lastOutcomeKind = "deduped";
      break;
    }
    case "empty": {
      const newest = outcome.newestProbedUrl ?? "<none>";
      summary = `No new CAFR; newest probed ${newest} returned 4xx`;
      ok = true;
      changed = false;
      hash = null;
      nextConsecutive = 0;
      lastOutcomeKind = "empty";
      break;
    }
    case "sourceFailure": {
      summary = `Source failure: ${outcome.lastError}`;
      ok = false;
      changed = false;
      hash = null;
      nextConsecutive = priorConsecutive + 1;
      if (nextConsecutive >= 3 && priorQuarantinedAt == null) {
        nextQuarantinedAt = now;
        newlyQuarantined = true;
      }
      lastOutcomeKind = "sourceFailure";
      break;
    }
    case "infraFailure": {
      summary = `Infra failure: ${outcome.error}`;
      ok = false;
      changed = false;
      hash = null;
      // nextConsecutive stays undefined - preserve column.
      lastOutcomeKind = "infraFailure";
      break;
    }
  }

  await recordHash(supabase, sourceKey, {
    hash,
    changed,
    ok,
    summary,
    expectedCadenceHours,
    consecutiveFailures: nextConsecutive,
    quarantinedAt: nextQuarantinedAt,
    lastOutcomeKind,
  });

  // Construct the post-write FingerprintStatus inline. Mirrors recordHash's
  // payload assembly so the return value matches the actual DB row without
  // a second SELECT.
  const fingerprint: FingerprintStatus = {
    sourceKey,
    lastHash: changed && hash != null ? hash : priorLastHash,
    lastCheckedAt: now,
    lastChangedAt: changed ? now : priorLastChangedAt,
    expectedCadenceHours: expectedCadenceHours ?? priorCadence,
    lastRunOk: ok,
    lastRunSummary: summary,
    consecutiveFailures:
      nextConsecutive !== undefined ? nextConsecutive : priorConsecutive,
    quarantinedAt:
      nextQuarantinedAt !== undefined ? nextQuarantinedAt : priorQuarantinedAt,
    lastOutcomeKind,
  };

  return { fingerprint, newlyQuarantined };
}
