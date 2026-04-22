/**
 * Scrape PA PSERS board-meeting resolution PDFs from the last N months and
 * insert each as a pending document. Dedup by content_hash.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-pa-psers.ts        # monthsBack=6
 *   pnpm tsx --env-file=.env.local scripts/scrape-pa-psers.ts 12
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapePAPsers } from "@/lib/scrapers/pa-psers";

async function main() {
  const nArg = Number(process.argv[2] ?? "6");
  const monthsBack = Math.max(1, Math.min(36, Number.isFinite(nArg) ? nArg : 6));

  const supabase = createSupabaseAdminClient();

  const { data: plan, error: pe } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "PA PSERS")
    .single();
  if (pe || !plan) {
    throw new Error(`PA PSERS plan not found: ${pe?.message ?? "no row"}`);
  }
  console.log(`Plan: ${plan.name} (${plan.id})`);
  console.log(`Scraping last ${monthsBack} months of PSERS board meetings...`);

  const t0 = Date.now();
  const r = await scrapePAPsers(supabase, { planId: plan.id, monthsBack });
  const ms = Date.now() - t0;

  console.log(`\n== Totals (${(ms / 1000).toFixed(1)}s)`);
  console.log(`Candidate dates probed:  ${r.candidateDatesProbed}`);
  console.log(`Meeting posts found:     ${r.meetingPostsFound}`);
  console.log(`Resolution PDFs found:   ${r.resolutionPdfsFound}`);
  console.log(`PDFs fetched:            ${r.pdfsFetched}`);
  console.log(`Inserted:                ${r.inserted}`);
  console.log(`Skipped (dup hash):      ${r.skipped}`);
  console.log(`404s (no meeting):       ${r.notFound}`);
  console.log(`Errors:                  ${r.errors.length}`);
  for (const e of r.errors) console.log(`  ! ${e.url}: ${e.message}`);
  console.log(`Total bytes fetched:     ${(r.totalBytes / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
