/**
 * One-off runner for the Massachusetts PRIM scraper.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-ma-prim.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-ma-prim.ts --months-back=24
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeMaPrim } from "@/lib/scrapers/ma-prim";

function parseArgs() {
  let monthsBack = 18;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--months-back=")) {
      monthsBack = Number(a.slice("--months-back=".length));
    }
  }
  if (!Number.isFinite(monthsBack) || monthsBack <= 0) {
    throw new Error(`invalid --months-back=${monthsBack}`);
  }
  return { monthsBack };
}

async function main() {
  const { monthsBack } = parseArgs();
  const supabase = createSupabaseAdminClient();

  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("scrape_config->>key", "ma_prim")
    .maybeSingle();
  if (!plan) {
    throw new Error(
      "Massachusetts PRIM plan not seeded. Apply migration 20260501000004_seed_oregon_ma_prim_plans.sql first.",
    );
  }

  const r = await scrapeMaPrim(supabase, { planId: plan.id, monthsBack });

  console.log("\n== Massachusetts PRIM scrape summary ==");
  console.log(`Candidate URLs probed: ${r.candidateUrlsProbed}`);
  console.log(`PDFs found:            ${r.pdfsFound}`);
  console.log(`PDFs fetched:          ${r.pdfsFetched}`);
  console.log(`Inserted:              ${r.inserted}`);
  console.log(`Skipped (dup):         ${r.skipped}`);
  console.log(`Not found (404):       ${r.notFound}`);
  console.log(`Bytes:                 ${r.totalBytes}`);
  console.log(`Errors:                ${r.errors.length}`);
  for (const e of r.errors) console.log(`  ! ${e.url}: ${e.message}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
