/**
 * Day 10 signal-only→thorough batch: Minnesota SBI Annual Report ingestion.
 *
 * Minnesota State Board of Investment fiscal year ends June 30. Annual
 * Reports publish to /sites/default/files/YYYY-MM/YYYY MSBI Annual
 * Report.pdf on msbi.us — the same host the board-minutes scraper hits.
 *
 * Source:
 *   https://www.msbi.us/sites/default/files/2026-03/2025%20MSBI%20Annual%20Report.pdf
 *
 * FY2025 (ended 2025-06-30). 3.9 MB — comfortable. Board-minutes
 * scraper (lib/scrapers/minnesota-sbi.ts) already runs daily for
 * commitment signals (with unpdf fallback for the malformed meeting
 * books added earlier this week); this runner is the annual allocation
 * pass.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-minnesota-sbi.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-minnesota-sbi.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://www.msbi.us/sites/default/files/2026-03/2025%20MSBI%20Annual%20Report.pdf";
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
    .eq("scrape_config->>key", "minnesota_sbi")
    .single();
  if (error || !plan) {
    throw new Error(`Minnesota SBI plan not found: ${error?.message ?? "not found"}`);
  }

  console.log(`Plan: ${plan.name} (${plan.id})`);
  console.log(`URL:  ${url}`);
  console.log(`FYE:  ${fiscalYearEnd}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "minnesota-sbi",
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
