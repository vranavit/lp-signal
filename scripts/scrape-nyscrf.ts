/**
 * Pull the last N months of NYSCRF Monthly Transaction Reports from the OSC
 * site and insert each as a document row (processing_status = 'pending').
 * Dedup by content_hash. Tolerates 404 for months not yet published.
 *
 * Does NOT trigger classification — run scripts/classify-pending.ts afterwards.
 *
 * Usage:
 *   pnpm tsx scripts/scrape-nyscrf.ts            # default monthsBack=6
 *   pnpm tsx scripts/scrape-nyscrf.ts 3
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeNYSCRF, nyscrfMonthCandidates } from "@/lib/scrapers/nyscrf";

async function main() {
  const nArg = Number(process.argv[2] ?? "6");
  const monthsBack = Math.max(1, Math.min(24, Number.isFinite(nArg) ? nArg : 6));

  const supabase = createSupabaseAdminClient();

  const { data: plan, error: pe } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "New York State Common Retirement Fund")
    .single();
  if (pe || !plan) {
    throw new Error(`NYSCRF plan not found: ${pe?.message ?? "no row"}`);
  }
  console.log(`Plan: ${plan.name} (${plan.id})`);

  const candidates = nyscrfMonthCandidates(monthsBack);
  console.log(`Attempting ${candidates.length} months (newest first):`);
  for (const c of candidates) console.log(`  - ${c.label}  ${c.url}`);

  const t0 = Date.now();
  const r = await scrapeNYSCRF(supabase, { planId: plan.id, monthsBack });
  const ms = Date.now() - t0;

  console.log(`\n== Totals (${(ms / 1000).toFixed(1)}s)`);
  console.log(`Months attempted:     ${r.monthsAttempted}`);
  console.log(`PDFs fetched:         ${r.pdfsFetched}`);
  console.log(`Inserted:             ${r.inserted}`);
  console.log(`Skipped (dup hash):   ${r.skipped}`);
  console.log(`Not yet published:    ${r.notYetPublished.length}`);
  for (const n of r.notYetPublished) console.log(`  · ${n.label}`);
  console.log(`Errors:               ${r.errors.length}`);
  for (const e of r.errors) console.log(`  ! ${e.url}: ${e.message}`);
  console.log(`Total bytes fetched:  ${(r.totalBytes / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
