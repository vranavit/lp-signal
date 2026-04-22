/**
 * Scrape CalSTRS Investment Committee PDFs from the last N months and insert
 * as pending documents. Dedup by content_hash.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-calstrs.ts           # monthsBack=6, maxPdfs=60
 *   pnpm tsx --env-file=.env.local scripts/scrape-calstrs.ts 3 20      # 3 months, cap 20 PDFs
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeCalSTRS } from "@/lib/scrapers/calstrs";

async function main() {
  const nArg = Number(process.argv[2] ?? "6");
  const capArg = Number(process.argv[3] ?? "60");
  const monthsBack = Math.max(1, Math.min(24, Number.isFinite(nArg) ? nArg : 6));
  const maxPdfs = Math.max(1, Math.min(200, Number.isFinite(capArg) ? capArg : 60));

  const supabase = createSupabaseAdminClient();

  const { data: plan, error: pe } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "CalSTRS")
    .single();
  if (pe || !plan) {
    throw new Error(`CalSTRS plan not found: ${pe?.message ?? "no row"}`);
  }
  console.log(`Plan: ${plan.name} (${plan.id})`);
  console.log(`Scraping last ${monthsBack} months (maxPdfs=${maxPdfs})...`);

  const t0 = Date.now();
  const r = await scrapeCalSTRS(supabase, {
    planId: plan.id,
    monthsBack,
    maxPdfs,
  });
  const ms = Date.now() - t0;

  console.log(`\n== Totals (${(ms / 1000).toFixed(1)}s)`);
  console.log(`Meetings considered:  ${r.meetingsConsidered}`);
  console.log(`PDFs fetched:         ${r.pdfsFound}`);
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
