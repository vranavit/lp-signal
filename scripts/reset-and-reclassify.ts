/**
 * Reset of one or more CAFR documents to pending, with deletion of any
 * pension_allocations rows that reference them. Then run the classifier
 * fresh against each document.
 *
 * Used for the v1.2-cafr prompt rollout (Phase-3 Round 1 of the actuals-gap
 * sprint): re-classify Ohio PERS + PA PSERS to pull actuals from the
 * Investment Section tables that v1.1 missed.
 *
 * Atomicity posture: ideal would be DELETE+UPDATE inside one BEGIN/COMMIT
 * via the pg client. The Supabase pooler endpoint is unreachable from this
 * box right now, so we fall back to supabase-js doing the two ops in
 * sequence. Recovery: if DELETE succeeds but UPDATE fails, the doc still
 * has processing_status='complete', so classify-pending won't pick it up
 * — re-running this script is safe (idempotent: 0 rows to re-delete + the
 * status update completes the reset).
 *
 * Usage:
 *   pnpm tsx scripts/reset-and-reclassify.ts <doc-id> [<doc-id> ...]
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { classifyDocument } from "@/lib/classifier";

async function main() {
  const docIds = process.argv.slice(2);
  if (docIds.length === 0) {
    console.error("usage: reset-and-reclassify.ts <doc-id> [<doc-id> ...]");
    process.exit(2);
  }
  const supabase = createSupabaseAdminClient();

  // Step 1 — reset.
  for (const id of docIds) {
    console.log(`\n── reset ${id} ──`);

    const { data: docCheck, error: docErr } = await supabase
      .from("documents")
      .select("id, processing_status")
      .eq("id", id)
      .single();
    if (docErr || !docCheck) {
      throw new Error(`document ${id} not found: ${docErr?.message}`);
    }
    const prevStatus = docCheck.processing_status;

    const { count: beforeCount, error: countErr } = await supabase
      .from("pension_allocations")
      .select("id", { count: "exact", head: true })
      .eq("source_document_id", id);
    if (countErr) throw new Error(`count failed: ${countErr.message}`);
    const rowsToDelete = beforeCount ?? 0;

    const { error: delErr, count: delCount } = await supabase
      .from("pension_allocations")
      .delete({ count: "exact" })
      .eq("source_document_id", id);
    if (delErr) throw new Error(`delete failed: ${delErr.message}`);

    const { error: updErr } = await supabase
      .from("documents")
      .update({
        processing_status: "pending",
        error_message: null,
        processed_at: null,
      })
      .eq("id", id);
    if (updErr) {
      throw new Error(
        `update failed AFTER ${delCount} rows deleted: ${updErr.message}. ` +
          `Re-run this script — doc still references the original storage bytes.`,
      );
    }
    console.log(
      `  prev_status=${prevStatus} deleted_allocations=${delCount}/${rowsToDelete} status→pending`,
    );
  }

  // Step 2 — re-classify each doc, fresh.
  for (const id of docIds) {
    console.log(`\n── reclassify ${id} ──`);
    const t0 = Date.now();
    const out = await classifyDocument(supabase, id);
    const ms = Date.now() - t0;
    const conf = out.confidences?.length
      ? `[${out.confidences.map((c) => c.toFixed(2)).join(",")}]`
      : "";
    const status = out.ok ? "ok" : `FAIL:${out.reason ?? "unknown"}`;
    console.log(
      `  ${status} pages=${out.pages ?? "-"} tokens=${out.tokensUsed} extracted=${out.signalsExtracted} inserted=${out.signalsInserted} accepted=${out.signalsAccepted} prelim=${out.signalsPreliminary} rej=${out.signalsRejected} conf=${conf} (${ms}ms)`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
