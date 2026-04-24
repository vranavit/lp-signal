/**
 * Day 10 signal-only→thorough batch: Michigan SMRS ACFR ingestion.
 *
 * "Michigan SMRS" (State of Michigan Retirement Systems) is the
 * umbrella pool managed by SMIB. MPSERS (Michigan Public School
 * Employees' Retirement System) is the largest plan in the pool by AUM
 * and the one Michigan Office of the Auditor General publishes a
 * dedicated ACFR for. MPSERS fiscal year ends September 30.
 *
 * Source:
 *   https://audgen.michigan.gov/wp-content/uploads/2025/03/
 *   Fiscal-Year-2024-MPSERS-ACFR.pdf
 *
 * FY2024 (ended 2024-09-30). 1.3 MB — comfortably under every ceiling.
 * Re-run once a year when the new fiscal-year ACFR drops (typically
 * February-March).
 *
 * Note: www.michigan.gov blocks non-browser clients with HTTP 403 via
 * Akamai, so we pull the ACFR from audgen.michigan.gov (the Office of
 * the Auditor General publishing host) which serves the same audited
 * document without the bot wall.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-michigan-smrs.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-michigan-smrs.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://audgen.michigan.gov/wp-content/uploads/2025/03/Fiscal-Year-2024-MPSERS-ACFR.pdf";
const DEFAULT_FISCAL_YEAR_END = "2024-09-30";

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
    .eq("scrape_config->>key", "michigan")
    .single();
  if (error || !plan) {
    throw new Error(`Michigan SMRS plan not found: ${error?.message ?? "not found"}`);
  }

  console.log(`Plan: ${plan.name} (${plan.id})`);
  console.log(`URL:  ${url}`);
  console.log(`FYE:  ${fiscalYearEnd}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "michigan-smrs",
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
