/**
 * Day 10 signal-only→thorough batch: LACERA ACFR ingestion.
 *
 * LACERA (LA County Employees Retirement Association) fiscal year ends
 * June 30. The ACFR publishes to
 * /sites/default/files/assets/documents/annual_reports/ACFR-YYYY.pdf.
 *
 * Source:
 *   https://www.lacera.gov/sites/default/files/assets/documents/annual_reports/ACFR-2025.pdf
 *
 * FY2025 (ended 2025-06-30). 12.8 MB — under the Anthropic 32 MB base64
 * inline ceiling (12.8 → ~17 MB base64, comfortable). Board-minutes
 * scraper (lib/scrapers/lacera.ts) already handles commitment signals
 * (including the 400-750 page agenda packets via the keyword-page
 * extractor added earlier this week); this runner is the annual
 * allocation pass.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-lacera.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-lacera.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://www.lacera.gov/sites/default/files/assets/documents/annual_reports/ACFR-2025.pdf";
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
    .eq("scrape_config->>key", "lacera")
    .single();
  if (error || !plan) {
    throw new Error(`LACERA plan not found: ${error?.message ?? "not found"}`);
  }

  console.log(`Plan: ${plan.name} (${plan.id})`);
  console.log(`URL:  ${url}`);
  console.log(`FYE:  ${fiscalYearEnd}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "lacera",
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
