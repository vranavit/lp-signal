/**
 * Reset + reclassify every document currently stuck in
 * processing_status='error' with an error_message matching
 * pdf_parse_failed*. Re-runs them through the classifier so the new
 * unpdf fallback (lib/classifier/extract-commitment-pages.ts) can
 * rescue the ones whose malformed cross-reference structure rejected
 * pdf-lib but parses cleanly with pdfjs.
 *
 * Scoped by default to Minnesota SBI (the immediate recovery target).
 * Pass --scrape-key=<key> to target another plan or --all to sweep
 * every plan.
 *
 * Usage:
 *   pnpm tsx scripts/reprocess-pdf-parse-failed.ts
 *   pnpm tsx scripts/reprocess-pdf-parse-failed.ts --dry-run
 *   pnpm tsx scripts/reprocess-pdf-parse-failed.ts --scrape-key=colorado_pera
 *   pnpm tsx scripts/reprocess-pdf-parse-failed.ts --all
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { classifyDocument } from "@/lib/classifier";

type DocRow = {
  id: string;
  source_url: string;
  error_message: string | null;
  plan_id: string;
};

function parseArgs() {
  let scrapeKey: string | null = "minnesota_sbi";
  let all = false;
  const dryRun = process.argv.includes("--dry-run");
  for (const a of process.argv.slice(2)) {
    if (a === "--all") {
      all = true;
      scrapeKey = null;
    } else if (a.startsWith("--scrape-key=")) {
      scrapeKey = a.slice("--scrape-key=".length);
      all = false;
    }
  }
  return { scrapeKey, all, dryRun };
}

async function main() {
  const { scrapeKey, all, dryRun } = parseArgs();
  const supabase = createSupabaseAdminClient();

  let planIds: string[] | null = null;
  if (!all) {
    const { data: plans, error } = await supabase
      .from("plans")
      .select("id, name")
      .eq("scrape_config->>key", scrapeKey!)
      .limit(1);
    if (error) throw error;
    const plan = plans?.[0];
    if (!plan) throw new Error(`plan not seeded for scrape_config.key=${scrapeKey}`);
    planIds = [plan.id];
    console.log(`Scope: ${plan.name} (${plan.id})`);
  } else {
    console.log("Scope: ALL plans");
  }

  let query = supabase
    .from("documents")
    .select("id, source_url, error_message, plan_id")
    .eq("processing_status", "error")
    .like("error_message", "pdf_parse_failed%");
  if (planIds) query = query.in("plan_id", planIds);
  const { data: stuck, error: docErr } = await query;
  if (docErr) throw docErr;
  const rows = (stuck ?? []) as DocRow[];
  console.log(`Stuck with pdf_parse_failed: ${rows.length}`);
  for (const d of rows) {
    console.log(`  ${d.source_url.slice(-55)} | ${d.error_message?.slice(0, 60)}`);
  }
  if (rows.length === 0) return;
  if (dryRun) return;

  const ids = rows.map((d) => d.id);
  const { error: rstErr } = await supabase
    .from("documents")
    .update({ processing_status: "pending", error_message: null, processed_at: null })
    .in("id", ids);
  if (rstErr) throw rstErr;

  let totalSignals = 0;
  let totalTokens = 0;
  let stillFailing = 0;
  let noContent = 0;
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i];
    const t0 = Date.now();
    let out;
    try {
      out = await classifyDocument(supabase, d.id);
    } catch (e) {
      stillFailing++;
      console.log(
        `  [${i + 1}/${rows.length}] THREW ${e instanceof Error ? e.message.slice(0, 80) : String(e)} → ${d.source_url.slice(-55)}`,
      );
      continue;
    }
    const ms = Date.now() - t0;
    totalSignals += out.signalsInserted;
    totalTokens += out.tokensUsed;
    if (out.reason === "no_commitment_content_in_agenda" || out.reason === "no_commitment_content_unpdf_fallback") noContent++;
    if (out.reason?.startsWith("pdf_parse_failed")) stillFailing++;
    const status = out.ok ? "ok" : `FAIL:${out.reason}`;
    console.log(
      `  [${i + 1}/${rows.length}] ${status} pages=${out.pages} sigs=${out.signalsInserted} tokens=${out.tokensUsed} (${ms}ms) → ${d.source_url.slice(-55)}`,
    );
  }
  console.log(
    `\nTotals: signals=${totalSignals} tokens=${totalTokens} no_content=${noContent} still_failing=${stillFailing}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
