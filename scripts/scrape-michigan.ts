/**
 * Scrape Michigan SMRS quarterly SMIB Reports from the last N months and
 * insert as pending documents. Dedup by content_hash.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-michigan.ts        # monthsBack=6
 *   pnpm tsx --env-file=.env.local scripts/scrape-michigan.ts 12
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeMichigan } from "@/lib/scrapers/michigan";

async function main() {
  const nArg = Number(process.argv[2] ?? "6");
  const monthsBack = Math.max(1, Math.min(36, Number.isFinite(nArg) ? nArg : 6));

  const supabase = createSupabaseAdminClient();

  const { data: plan, error: pe } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "Michigan SMRS")
    .single();
  if (pe || !plan) {
    throw new Error(`Michigan SMRS plan not found: ${pe?.message ?? "no row"}`);
  }
  console.log(`Plan: ${plan.name} (${plan.id})`);
  console.log(`Scraping last ${monthsBack} months of SMIB reports...`);

  const t0 = Date.now();
  const r = await scrapeMichigan(supabase, { planId: plan.id, monthsBack });
  const ms = Date.now() - t0;

  console.log(`\n== Totals (${(ms / 1000).toFixed(1)}s)`);
  console.log(`SMIB reports found:   ${r.reportsFound}`);
  console.log(`Candidates considered:${r.candidatesConsidered}`);
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
