/**
 * Unblock Ohio PERS CAFR ingestion.
 *
 * Ohio PERS was flagged blocked in docs/scraper-inventory.md because
 * the *board meetings* index at /about/board/meetings/ only shows a
 * dates table (no document links). But the *financial reports* page
 * at /financial/reports.shtml DOES publish the annual report PDFs
 * under /pubs-archive/financial/YYYY-OPERS-Annual-Report.pdf — five
 * years back to 2020, no bot wall, standard anchors. That unblocks
 * the allocation-data side of the Ohio coverage even if commitment-
 * signal board-minutes scraping stays deferred.
 *
 * Source: https://www.opers.org/financial/reports.shtml
 *
 * FY2024 Annual Report, 16.3 MB, 250+ pages. Ohio PERS fiscal year is
 * the calendar year, so the 2024 report covers FY ended 2024-12-31.
 *
 * Note on document_type: ingestCafr writes 'cafr' so the classifier
 * routes through the allocation-extraction path. See same note in
 * scripts/scrape-cafr-florida-sba.ts.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-ohio-pers.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-ohio-pers.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://www.opers.org/pubs-archive/financial/2024-OPERS-Annual-Report.pdf";
const DEFAULT_FISCAL_YEAR_END = "2024-12-31";

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
    .eq("scrape_config->>key", "ohio_pers")
    .single();
  if (error || !plan) {
    throw new Error(`Ohio PERS plan not found: ${error?.message ?? "not found"}`);
  }

  console.log(`[Ohio PERS] Plan: ${plan.name} (${plan.id})`);
  console.log(`[Ohio PERS] URL:  ${url}`);
  console.log(`[Ohio PERS] FYE:  ${fiscalYearEnd}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "ohio-pers",
    url,
    fiscalYearEnd,
  });

  console.log(
    `[Ohio PERS] fetched=${r.fetched} inserted=${r.inserted} skipped=${r.skipped} bytes=${(r.bytes / 1024 / 1024).toFixed(2)}MB${r.error ? " error=" + r.error : ""}`,
  );
  if (r.documentId) console.log(`[Ohio PERS] documentId=${r.documentId}`);
  if (r.error) process.exit(1);
}

main().catch((e) => {
  console.error(`[Ohio PERS] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
