/**
 * Scrape NYSTRS PE_Commitments.pdf (rolling quarterly log) and insert as a
 * pending document. Dedup by content_hash — no-op if the file hasn't been
 * updated since last run.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-nystrs.ts
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeNYSTRS } from "@/lib/scrapers/nystrs";

async function main() {
  const supabase = createSupabaseAdminClient();

  const { data: plan, error: pe } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "NYSTRS")
    .single();
  if (pe || !plan) {
    throw new Error(`NYSTRS plan not found: ${pe?.message ?? "no row"}`);
  }
  console.log(`Plan: ${plan.name} (${plan.id})`);

  const t0 = Date.now();
  const r = await scrapeNYSTRS(supabase, { planId: plan.id });
  const ms = Date.now() - t0;

  console.log(`\n== Totals (${(ms / 1000).toFixed(1)}s)`);
  console.log(`PDFs fetched:         ${r.pdfsFetched}`);
  console.log(`Inserted:             ${r.inserted}`);
  console.log(`Skipped (dup hash):   ${r.skipped}`);
  console.log(`Errors:               ${r.errors.length}`);
  for (const e of r.errors) console.log(`  ! ${e.url}: ${e.message}`);
  console.log(`Total bytes fetched:  ${(r.totalBytes / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
