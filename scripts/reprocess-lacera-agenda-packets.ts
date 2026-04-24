/**
 * Reset + reclassify every LACERA `agenda_packet` document currently
 * stuck in `processing_status='error'` (too_long, request_too_large,
 * or otherwise). Re-routes them through the keyword-page extractor
 * that lib/classifier/index.ts adds for `agenda_packet` types.
 *
 * Idempotent — docs already `complete` are left alone.
 *
 * Usage:
 *   pnpm tsx scripts/reprocess-lacera-agenda-packets.ts
 *   pnpm tsx scripts/reprocess-lacera-agenda-packets.ts --dry-run
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { classifyDocument } from "@/lib/classifier";

function parseArgs() {
  return { dryRun: process.argv.includes("--dry-run") };
}

async function main() {
  const { dryRun } = parseArgs();
  const supabase = createSupabaseAdminClient();

  const { data: plans, error: planErr } = await supabase
    .from("plans")
    .select("id, name")
    .eq("scrape_config->>key", "lacera")
    .limit(1);
  if (planErr) throw planErr;
  const plan = plans?.[0];
  if (!plan) throw new Error("LACERA plan not seeded");

  const { data: stuck, error: docErr } = await supabase
    .from("documents")
    .select("id, source_url, error_message")
    .eq("plan_id", plan.id)
    .eq("document_type", "agenda_packet")
    .eq("processing_status", "error");
  if (docErr) throw docErr;
  console.log(`Stuck LACERA agenda packets: ${stuck?.length ?? 0}`);
  for (const d of stuck ?? []) {
    console.log(
      `  ${d.source_url.slice(-55)} | ${d.error_message?.slice(0, 60) ?? "-"}`,
    );
  }
  if (!stuck || stuck.length === 0) return;
  if (dryRun) return;

  // Reset to pending so classifyDocument picks them up.
  const ids = stuck.map((d) => d.id);
  const { error: rstErr } = await supabase
    .from("documents")
    .update({ processing_status: "pending", error_message: null, processed_at: null })
    .in("id", ids);
  if (rstErr) throw rstErr;

  let totalSignals = 0;
  let totalTokens = 0;
  let zeroCommitCount = 0;
  for (let i = 0; i < stuck.length; i++) {
    const d = stuck[i];
    const t0 = Date.now();
    const out = await classifyDocument(supabase, d.id);
    const ms = Date.now() - t0;
    totalSignals += out.signalsInserted;
    totalTokens += out.tokensUsed;
    if (out.reason === "no_commitment_content_in_agenda") zeroCommitCount++;
    const status = out.ok ? "ok" : `FAIL:${out.reason}`;
    console.log(
      `  [${i + 1}/${stuck.length}] ${status} pages=${out.pages} sigs=${out.signalsInserted} tokens=${out.tokensUsed} (${ms}ms)`,
    );
  }
  console.log(
    `\nTotals: signals=${totalSignals} tokens=${totalTokens} no_commitment=${zeroCommitCount}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
