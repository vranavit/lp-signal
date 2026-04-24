/**
 * Day 10 signal-only→thorough batch: Virginia Retirement System ACFR ingestion.
 *
 * VRS fiscal year ends June 30. The ACFR publishes to
 * /media/shared/pdf/publications/YYYY-annual-report.pdf under a stable
 * filename pattern — when the FY2026 report lands, just increment.
 *
 * Source:
 *   https://www.varetire.org/media/shared/pdf/publications/2025-annual-report.pdf
 *
 * FY2025 (ended 2025-06-30). 3.2 MB — comfortable. Board-minutes
 * scraper (lib/scrapers/vrs.ts) already runs daily for commitment
 * signals; this runner is the annual allocation pass.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-vrs.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-vrs.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://www.varetire.org/media/shared/pdf/publications/2025-annual-report.pdf";
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
    .eq("scrape_config->>key", "vrs")
    .single();
  if (error || !plan) {
    throw new Error(`VRS plan not found: ${error?.message ?? "not found"}`);
  }

  console.log(`Plan: ${plan.name} (${plan.id})`);
  console.log(`URL:  ${url}`);
  console.log(`FYE:  ${fiscalYearEnd}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "vrs",
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
