/**
 * Ingest the most recent NCRS Quarterly Investment Report.
 *
 * Replaces scripts/scrape-cafr-nc-retirement.ts (which targeted the FY2024
 * NCRS Investment Programs financial statements at nctreasurer.gov/media/
 * 5216/open). That source described sub-strategy targets within asset
 * classes but lacked per-class %-of-total actuals — every row landed at
 * 0.72 confidence, preliminary-tier.
 *
 * The Quarterly Investment Report (NCRS QIR) at /imdiac/quarterly-
 * investment-report-qir-{YYYY}q{N}/open has, on p.4, an "IPS Asset Class
 * Performance" table with Market Value $000 per IPS class, plus on p.9 a
 * "Statutory Compliance" table with explicit "Percentage of Total Assets
 * Invested" actuals per statutory class. Together these give the v1.2-cafr
 * classifier both target and actual at the same granularity.
 *
 * As-of 2025-09-30 (Q3 2025). Update the URL each quarter when a new QIR
 * publishes. See docs/audits/actuals-gap-phase1-2026-04-26.md (Phase 1).
 *
 * Run scripts/replace-allocation-source.ts --plan-key=nc_retirement first
 * to drop the prior FY2024 document + its 9 preliminary allocation rows.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-ncrs.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-ncrs.ts --url=<alt URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://www.nctreasurer.gov/documents/files/imdiac/quarterly-investment-report-qir-2025q3/open";
const DEFAULT_FISCAL_YEAR_END = "2025-09-30"; // Q3 2025 quarter end.

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
    throw new Error(`NCRS plan not found: ${error?.message ?? "not found"}`);
  }

  console.log(`[NCRS] Plan: ${plan.name} (${plan.id})`);
  console.log(`[NCRS] URL:  ${url}`);
  console.log(`[NCRS] FYE:  ${fiscalYearEnd}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "nc-retirement",
    url,
    fiscalYearEnd,
  });

  console.log(
    `[NCRS] fetched=${r.fetched} inserted=${r.inserted} skipped=${r.skipped} bytes=${(r.bytes / 1024 / 1024).toFixed(2)}MB${r.error ? " error=" + r.error : ""}`,
  );
  if (r.documentId) console.log(`[NCRS] documentId=${r.documentId}`);
  if (r.error) process.exit(1);
}

main().catch((e) => {
  console.error(`[NCRS] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
