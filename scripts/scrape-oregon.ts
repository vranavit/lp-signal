/**
 * One-off runner for the Oregon Investment Council scraper.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-oregon.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-oregon.ts --max-pdfs=40
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeOregon } from "@/lib/scrapers/oregon";

function parseArgs() {
  let maxPdfs = 20;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--max-pdfs=")) {
      maxPdfs = Number(a.slice("--max-pdfs=".length));
    }
  }
  if (!Number.isFinite(maxPdfs) || maxPdfs <= 0) {
    throw new Error(`invalid --max-pdfs=${maxPdfs}`);
  }
  return { maxPdfs };
}

async function main() {
  const { maxPdfs } = parseArgs();
  const supabase = createSupabaseAdminClient();

  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("scrape_config->>key", "oregon_pers")
    .maybeSingle();
  if (!plan) {
    throw new Error(
      "Oregon PERS plan not seeded. Apply migration 20260501000004_seed_oregon_ma_prim_plans.sql first.",
    );
  }

  const r = await scrapeOregon(supabase, { planId: plan.id, maxPdfs });

  console.log("\n== Oregon OIC scrape summary ==");
  console.log(`Candidates found: ${r.candidatesFound}`);
  console.log(`PDFs fetched:     ${r.pdfsFetched}`);
  console.log(`Inserted:         ${r.inserted}`);
  console.log(`Skipped (dup):    ${r.skipped}`);
  console.log(`Bytes:            ${r.totalBytes}`);
  console.log(`Errors:           ${r.errors.length}`);
  for (const e of r.errors) console.log(`  ! ${e.url}: ${e.message}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
