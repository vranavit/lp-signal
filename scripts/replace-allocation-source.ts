/**
 * Delete a plan's existing CAFR-style allocation source document and any
 * pension_allocations rows referencing it. Called before re-ingesting from
 * a different source URL (e.g. switching from a State CAFR to a dedicated
 * NYSLRS ACFR, or from an annual report to a quarterly investment report).
 *
 * Why two steps: pension_allocations.source_document_id has ON DELETE SET
 * NULL, so deleting a document without first deleting its allocation rows
 * produces orphans. We delete in dependency order.
 *
 * Pre-deletion the script lists the documents that match. If none match,
 * it exits 0 (idempotent — safe to re-run).
 *
 * Usage:
 *   pnpm tsx scripts/replace-allocation-source.ts \
 *     --plan-key=nc_retirement [--plan-name="..."] [--dry-run]
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Args = { planKey?: string; planName?: string; dryRun: boolean };

function parseArgs(): Args {
  let planKey: string | undefined;
  let planName: string | undefined;
  let dryRun = false;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--plan-key=")) planKey = a.slice("--plan-key=".length);
    else if (a.startsWith("--plan-name=")) planName = a.slice("--plan-name=".length);
    else if (a === "--dry-run") dryRun = true;
  }
  return { planKey, planName, dryRun };
}

async function main() {
  const { planKey, planName, dryRun } = parseArgs();
  if (!planKey && !planName) {
    console.error("usage: --plan-key=<key> | --plan-name=<name> [--dry-run]");
    process.exit(2);
  }

  const supabase = createSupabaseAdminClient();
  const q = supabase.from("plans").select("id, name").limit(1);
  const { data: plan, error: planErr } = await (planKey
    ? q.eq("scrape_config->>key", planKey)
    : q.eq("name", planName!)
  ).single();
  if (planErr || !plan) throw new Error(`plan not found: ${planErr?.message}`);

  console.log(`plan: ${plan.name} (${plan.id})`);

  const { data: docs } = await supabase
    .from("documents")
    .select("id, source_url, document_type, meeting_date, processing_status")
    .eq("plan_id", plan.id)
    .eq("document_type", "cafr");
  console.log(`existing cafr documents: ${docs?.length ?? 0}`);
  for (const d of docs ?? []) {
    console.log(
      `  doc ${d.id} fye=${d.meeting_date} status=${d.processing_status}\n    url=${d.source_url}`,
    );
  }

  if (!docs || docs.length === 0) {
    console.log("nothing to delete — exit 0");
    return;
  }

  const docIds = docs.map((d) => d.id);
  const { count: allocCount } = await supabase
    .from("pension_allocations")
    .select("id", { count: "exact", head: true })
    .in("source_document_id", docIds);
  console.log(`pension_allocations rows referencing these docs: ${allocCount ?? 0}`);

  if (dryRun) {
    console.log("[dry-run] no deletions performed");
    return;
  }

  const { error: delAlloc, count: delAllocN } = await supabase
    .from("pension_allocations")
    .delete({ count: "exact" })
    .in("source_document_id", docIds);
  if (delAlloc) throw new Error(`delete allocations failed: ${delAlloc.message}`);
  console.log(`deleted pension_allocations: ${delAllocN}`);

  const { error: delDoc, count: delDocN } = await supabase
    .from("documents")
    .delete({ count: "exact" })
    .in("id", docIds);
  if (delDoc) throw new Error(`delete documents failed: ${delDoc.message}`);
  console.log(`deleted documents: ${delDocN}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
