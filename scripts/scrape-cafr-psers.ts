/**
 * Day 10 signal-only→thorough batch: PA PSERS ACFR ingestion.
 *
 * Pennsylvania Public School Employees' Retirement System publishes the
 * Annual Comprehensive Financial Report at pa.gov for each fiscal year.
 * PSERS fiscal year ends June 30. Latest published (2026-04) covers
 * fiscal years ended 2025-06-30 and 2024-06-30.
 *
 * Source: https://www.pa.gov/content/dam/copapwp-pagov/en/psers/
 *         documents/transparency/financial-reports/acfr/
 *         psers%20acfr%20fy2025.pdf
 *
 * FY2025. 1.9 MB, ~170 pages — well inside the Anthropic 32 MB base64
 * ceiling and the classifier's 500-page CAFR_MAX_PAGES cap.
 *
 * Board-minutes scraper (lib/scrapers/pa-psers.ts) already runs daily.
 * This runner is one-off — re-run once a year when the new ACFR drops.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-psers.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-psers.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://www.pa.gov/content/dam/copapwp-pagov/en/psers/documents/transparency/financial-reports/acfr/psers%20acfr%20fy2025.pdf";
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
    .eq("scrape_config->>key", "pa_psers")
    .single();
  if (error || !plan) {
    throw new Error(`PA PSERS plan not found: ${error?.message ?? "not found"}`);
  }

  console.log(`Plan: ${plan.name} (${plan.id})`);
  console.log(`URL:  ${url}`);
  console.log(`FYE:  ${fiscalYearEnd}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "pa-psers",
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
