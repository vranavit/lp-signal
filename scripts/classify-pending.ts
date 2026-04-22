/**
 * Run the classifier against all pending documents by calling the same
 * orchestrator the /api/cron/classify route uses. No HTTP, no dev server.
 * Used for Phase 2 validation.
 *
 * Usage:
 *   pnpm tsx scripts/classify-pending.ts [limit]
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { classifyDocument } from "@/lib/classifier";

async function main() {
  const limit = Math.max(1, Math.min(100, Number(process.argv[2] ?? "50")));
  const supabase = createSupabaseAdminClient();

  const { data: pending, error } = await supabase
    .from("documents")
    .select("id, source_url, meeting_date")
    .eq("processing_status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  const docs = pending ?? [];
  console.log(`Pending documents to classify: ${docs.length}`);

  const startedAt = Date.now();
  let totalSignals = 0;
  let totalTokens = 0;

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const t0 = Date.now();
    const out = await classifyDocument(supabase, d.id);
    const ms = Date.now() - t0;
    totalSignals += out.signalsInserted;
    totalTokens += out.tokensUsed;
    const confSummary = out.confidences?.length
      ? `conf=[${out.confidences.map((c) => c.toFixed(2)).join(",")}]`
      : "";
    const status = out.ok ? "ok" : `FAIL:${out.reason}`;
    const tierSummary = out.ok
      ? `acc=${out.signalsAccepted} prelim=${out.signalsPreliminary} rej=${out.signalsRejected}`
      : "";
    console.log(
      `  [${i + 1}/${docs.length}] ${status} pages=${out.pages ?? "-"} tokens=${out.tokensUsed} ${tierSummary} ${confSummary} (${ms}ms)`,
    );
    console.log(`           ${d.source_url}`);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nTotals: signals=${totalSignals} tokens=${totalTokens} elapsed=${elapsed}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
