/**
 * Day 9.5 · H-3 retry harness.
 *
 * Retry documents stuck in processing_status='error'. Groups candidates by
 * root cause and only re-runs the buckets the caller asks for.
 *
 * Buckets (matches audit 2026-04-23 and the DB):
 *   schema_validation  — classifier output didn't match the Zod schema
 *                        (most commonly `fields.amount_usd: null`). Likely a
 *                        prompt gap; do NOT retry by default.
 *   storage_5xx        — Supabase Storage returned Bad/Gateway Timeout.
 *                        Transient; safe to retry.
 *   out_of_scope       — transcripts correctly rejected. Do not retry.
 *   too_long           — PDF exceeds MAX_PAGES (100). Needs chunking; defer.
 *   other              — anything else.
 *
 * The retry mechanism flips processing_status → 'pending' (clearing
 * error_message), then calls lib/classifier/index::classifyDocument, which
 * only runs on pending rows. The classifier updates the doc on completion
 * or re-errors it with a fresh error_message.
 *
 * Usage:
 *   pnpm tsx scripts/retry-failed-documents.ts --error-type=storage_5xx
 *   pnpm tsx scripts/retry-failed-documents.ts --dry-run --error-type=all
 *
 * A log file is written to docs/retry-log-YYYY-MM-DD.md for the historical
 * record.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyDocument } from "@/lib/classifier";

type Bucket =
  | "schema_validation"
  | "storage_5xx"
  | "out_of_scope"
  | "too_long"
  | "other"
  | "all";

type Candidate = {
  id: string;
  plan: string | null;
  gp: string | null;
  document_type: string;
  error_message: string | null;
  storage_path: string | null;
  source_url: string | null;
  bucket: Bucket;
};

function classify(errorMessage: string | null): Bucket {
  if (!errorMessage) return "other";
  if (errorMessage.startsWith("classifier output failed schema validation"))
    return "schema_validation";
  if (errorMessage.startsWith("out_of_scope")) return "out_of_scope";
  if (errorMessage.startsWith("storage download failed")) return "storage_5xx";
  if (errorMessage.startsWith("too_long")) return "too_long";
  return "other";
}

function parseArgs() {
  const args = process.argv.slice(2);
  let errorType: Bucket = "storage_5xx";
  let dryRun = false;
  for (const a of args) {
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--error-type=")) {
      errorType = a.slice("--error-type=".length) as Bucket;
    }
  }
  return { errorType, dryRun };
}

async function loadCandidates(
  supabase: SupabaseClient,
  bucket: Bucket,
): Promise<Candidate[]> {
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, document_type, error_message, storage_path, source_url, plan:plans(name), gp:gps(name)",
    )
    .eq("processing_status", "error")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`load failed: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    document_type: string;
    error_message: string | null;
    storage_path: string | null;
    source_url: string | null;
    plan: { name: string } | null;
    gp: { name: string } | null;
  }>;
  return rows
    .map((r) => ({
      id: r.id,
      plan: r.plan?.name ?? null,
      gp: r.gp?.name ?? null,
      document_type: r.document_type,
      error_message: r.error_message,
      storage_path: r.storage_path,
      source_url: r.source_url,
      bucket: classify(r.error_message),
    }))
    .filter((c) => bucket === "all" || c.bucket === bucket);
}

async function retryOne(
  supabase: SupabaseClient,
  cand: Candidate,
): Promise<{
  id: string;
  ok: boolean;
  signalsInserted?: number;
  reason?: string;
  before: string | null;
  after: string | null;
}> {
  // Flip back to pending so classifyDocument will run. Keep a snapshot of the
  // prior error for the log.
  const before = cand.error_message;
  const { error: updErr } = await supabase
    .from("documents")
    .update({ processing_status: "pending", error_message: null })
    .eq("id", cand.id);
  if (updErr) {
    return { id: cand.id, ok: false, reason: `reset_failed: ${updErr.message}`, before, after: null };
  }
  const outcome = await classifyDocument(supabase, cand.id);
  // Fetch the post-run state so the log reflects truth (classifyDocument may
  // have flipped it back to error with a fresh message).
  const { data: after } = await supabase
    .from("documents")
    .select("processing_status, error_message")
    .eq("id", cand.id)
    .maybeSingle();
  return {
    id: cand.id,
    ok: outcome.ok,
    signalsInserted: outcome.signalsInserted,
    reason: outcome.reason,
    before,
    after: after?.error_message ?? null,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const { errorType, dryRun } = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY required (same pattern as lib/supabase/admin.ts)",
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY missing — retry needs the classifier");
  }
  const supabase = createClient(url, key);

  const cands = await loadCandidates(supabase, errorType);
  console.log(
    `\ncandidates for bucket=${errorType}: ${cands.length}${dryRun ? " (dry run)" : ""}`,
  );
  for (const c of cands) {
    console.log(
      `  ${c.id.slice(0, 8)} · ${(c.plan ?? c.gp ?? "—").padEnd(24)} · ${c.bucket.padEnd(18)} · ${(c.error_message ?? "").slice(0, 80)}`,
    );
  }

  if (dryRun || cands.length === 0) return;

  const logPath = path.join("docs", `retry-log-${today()}.md`);
  const lines: string[] = [];
  lines.push(`# Retry log — ${today()}`);
  lines.push("");
  lines.push(`- bucket: \`${errorType}\``);
  lines.push(`- candidates: ${cands.length}`);
  lines.push("");

  let ok = 0;
  let fail = 0;
  for (const c of cands) {
    console.log(`\nretrying ${c.id.slice(0, 8)} (${c.plan ?? c.gp})...`);
    const result = await retryOne(supabase, c);
    if (result.ok) {
      ok++;
      console.log(
        `  ✓ ok · signals inserted: ${result.signalsInserted ?? 0}`,
      );
    } else {
      fail++;
      console.log(`  ✗ still failing · ${result.reason ?? result.after}`);
    }
    lines.push(`## ${c.id}`);
    lines.push(`- who: ${c.plan ?? c.gp}`);
    lines.push(`- bucket: \`${c.bucket}\``);
    lines.push(`- before: \`${result.before?.replace(/`/g, "'").slice(0, 200) ?? "—"}\``);
    lines.push(
      `- after: ${result.ok ? `**complete**, ${result.signalsInserted ?? 0} signals inserted` : `**still error** · \`${(result.after ?? result.reason ?? "—").replace(/`/g, "'").slice(0, 200)}\``}`,
    );
    lines.push("");
  }

  lines.push(`## summary`);
  lines.push(`- retried ok: ${ok}`);
  lines.push(`- still failing: ${fail}`);

  fs.writeFileSync(logPath, lines.join("\n") + "\n");
  console.log(`\nlog: ${logPath}`);
  console.log(`retried ok: ${ok}, still failing: ${fail}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
