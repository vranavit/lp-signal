/**
 * One-off runner for the LACERA scraper.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-lacera.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-lacera.ts --months-back=24
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeLacera } from "@/lib/scrapers/lacera";

function parseArgs() {
  let monthsBack = 18;
  let maxCandidates = 400;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--months-back=")) {
      monthsBack = Number(a.slice("--months-back=".length));
    } else if (a.startsWith("--max-candidates=")) {
      maxCandidates = Number(a.slice("--max-candidates=".length));
    }
  }
  if (!Number.isFinite(monthsBack) || monthsBack <= 0) {
    throw new Error(`invalid --months-back=${monthsBack}`);
  }
  if (!Number.isFinite(maxCandidates) || maxCandidates <= 0) {
    throw new Error(`invalid --max-candidates=${maxCandidates}`);
  }
  return { monthsBack, maxCandidates };
}

async function main() {
  const { monthsBack, maxCandidates } = parseArgs();
  const supabase = createSupabaseAdminClient();

  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("scrape_config->>key", "lacera")
    .maybeSingle();
  if (!plan) {
    throw new Error(
      "LACERA plan not seeded. Apply migration 20260501000008_seed_lacera.sql first.",
    );
  }

  const r = await scrapeLacera(supabase, {
    planId: plan.id,
    monthsBack,
    maxCandidates,
  });

  console.log("\n== LACERA scrape summary ==");
  console.log(`Index candidates:      ${r.indexCandidates}`);
  console.log(`Probe candidates:      ${r.probeCandidates}`);
  console.log(`Candidate URLs probed: ${r.candidateUrlsProbed}`);
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
