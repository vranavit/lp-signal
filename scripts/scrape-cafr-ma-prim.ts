/**
 * Day 10 signal-only→thorough batch: Massachusetts PRIM ACFR ingestion.
 *
 * PRIT Fund (Massachusetts Pension Reserves Investment Management Board)
 * fiscal year ends June 30. The ACFR publishes annually at mapension.com
 * under /wp-content/uploads/YYYY/MM/ with the fiscal-year-end date
 * embedded in the filename.
 *
 * Source:
 *   https://www.mapension.com/wp-content/uploads/2025/12/
 *   PRIT-Annual-Comprehensive-Financial-Report-06302025.pdf
 *
 * FY2025 (ended 2025-06-30). 2.9 MB — comfortable within every ceiling.
 * Board-minutes scraper (lib/scrapers/ma-prim.ts) already covers
 * commitment signals via the daily cron; this runner is the one-off
 * allocation pass. Re-run yearly when the new ACFR drops (typically
 * December for a June-end fiscal year).
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-ma-prim.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-ma-prim.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://www.mapension.com/wp-content/uploads/2025/12/PRIT-Annual-Comprehensive-Financial-Report-06302025.pdf";
const DEFAULT_FISCAL_YEAR_END = "2025-06-30";

function parseArgs() {
  let url = DEFAULT_URL;
  let fiscalYearEnd = DEFAULT_FISCAL_YEAR_END;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--url=")) url = a.slice("--url=".length);
    else if (a.startsWith("--fiscal-year-end="))
      fiscalYearEnd = a.slice("--fiscal-year-end=".length);
  }
  return { url, fiscalYearEnd };
}

async function main() {
  const { url, fiscalYearEnd } = parseArgs();
  const supabase = createSupabaseAdminClient();

  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("scrape_config->>key", "ma_prim")
    .single();
  if (error || !plan) {
    throw new Error(`MA PRIM plan not found: ${error?.message ?? "not found"}`);
  }

  console.log(`Plan: ${plan.name} (${plan.id})`);
  console.log(`URL:  ${url}`);
  console.log(`FYE:  ${fiscalYearEnd}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "ma-prim",
    url,
    fiscalYearEnd,
  });

  console.log(
    `\nfetched=${r.fetched} inserted=${r.inserted} skipped=${r.skipped} bytes=${(r.bytes / 1024 / 1024).toFixed(2)}MB${r.error ? " error=" + r.error : ""}`,
  );
  if (r.documentId) console.log(`documentId=${r.documentId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
