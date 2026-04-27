/**
 * DEPRECATED 2026-04-27 (PR 3, sub-project B). Use
 * `scripts/scrape-cafr-ncrs.ts` instead. The newer script targets the
 * NCRS Quarterly Investment Report URL pattern
 * (`/imdiac/quarterly-investment-report-qir-{YYYY}q{N}/open`) which
 * provides both target and actual allocations at the same granularity
 * for the v1.2-cafr classifier. This file targets the older
 * `/media/5216/open` legacy URL whose actuals coverage is weaker.
 *
 * Auto-ingestion via `lib/scrapers/cafr-adapters/nc_retirement.ts`
 * uses the newer pattern. This script is kept for one-shot manual
 * ingests only; removal is deferred to a future cleanup PR.
 *
 * Original docstring follows.
 *
 * Unblock North Carolina Retirement Systems CAFR ingestion.
 *
 * NC has two publishing hosts today:
 *
 *   1. nctreasurer.gov/media/<id>/open — legacy but still serves the
 *      FY2024 NCRS Investment Programs financial statements (458 KB)
 *      at /media/5216/open. Tabular policy portfolio + actuals, the
 *      shape the CAFR classifier expects.
 *   2. ncinvest.gov/ncia/ncia-MM-YYYY-monthly-report/open — dedicated
 *      North Carolina Investment Authority host. Publishes monthly
 *      investment reports with narrative summaries; a prior run of
 *      this scraper against the Feb 2026 monthly report (1.5 MB)
 *      classified with 0 accepted + 1 preliminary + 8 dropped rows
 *      because the monthly format is prose-heavy rather than tabular.
 *
 * Default is now the nctreasurer.gov /media/5216/open FY2024
 * financial statements. The NCIA monthly report remains a documented
 * fallback for cases where the user wants fresher-but-narrative data.
 *
 * Source: https://www.nctreasurer.gov/media/5216/open
 *
 * FY2024 covers fiscal year ended 2024-06-30 (NC fiscal year runs
 * July 1 to June 30).
 *
 * Note on document_type: ingestCafr writes 'cafr' so the classifier
 * routes through the allocation-extraction path. See same note in
 * scripts/scrape-cafr-florida-sba.ts.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-nc-retirement.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-nc-retirement.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 *
 * Fallback URL (prior default — narrative format, weaker extraction):
 *   https://www.ncinvest.gov/ncia/ncia-02-2026-monthly-report/open
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL = "https://www.nctreasurer.gov/media/5216/open";
const DEFAULT_FISCAL_YEAR_END = "2024-06-30";

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
    .eq("scrape_config->>key", "nc_retirement")
    .single();
  if (error || !plan) {
    throw new Error(
      `North Carolina plan not found: ${error?.message ?? "not found"}`,
    );
  }

  console.log(`[NC Retirement] Plan: ${plan.name} (${plan.id})`);
  console.log(`[NC Retirement] URL:  ${url}`);
  console.log(`[NC Retirement] FYE:  ${fiscalYearEnd}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "nc-retirement",
    url,
    fiscalYearEnd,
  });

  console.log(
    `[NC Retirement] fetched=${r.fetched} inserted=${r.inserted} skipped=${r.skipped} bytes=${(r.bytes / 1024 / 1024).toFixed(2)}MB${r.error ? " error=" + r.error : ""}`,
  );
  if (r.documentId) console.log(`[NC Retirement] documentId=${r.documentId}`);
  if (r.error) process.exit(1);
}

main().catch((e) => {
  console.error(`[NC Retirement] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
