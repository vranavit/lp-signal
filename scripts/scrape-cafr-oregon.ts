/**
 * Day 10 Task C+ Component 3: Oregon PERS ACFR ingestion.
 *
 * Converts Oregon PERS from signals-only (50+ board-minutes signals
 * since Session 2) into "thorough" — signals + allocation data.
 *
 * Source:
 *   https://www.oregon.gov/pers/Documents/Financials/ACFR/2025-ACFR.pdf
 *
 * FY2025 (fiscal year ended 2025-06-30). 198 pages, 6.9 MB — well under
 * Anthropic's 32 MB base64 request ceiling and the classifier's 500-
 * page CAFR_MAX_PAGES cap, so single-pass ingestion is safe.
 *
 * The board-minutes scraper (lib/scrapers/oregon.ts) already runs daily
 * via the wave-2 fan-out; this runner is one-off. Re-run once a year
 * when the new ACFR drops (typically Dec for FY ending Jun 30). The
 * published URL pattern is /pers/Documents/Financials/ACFR/YYYY-ACFR.pdf
 * — when the 2026 ACFR lands, swap CAFR_URL and FISCAL_YEAR_END.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-oregon.ts
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const CAFR_URL =
  "https://www.oregon.gov/pers/Documents/Financials/ACFR/2025-ACFR.pdf";
const FISCAL_YEAR_END = "2025-06-30";

async function main() {
  const supabase = createSupabaseAdminClient();

  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("scrape_config->>key", "oregon_pers")
    .single();
  if (error || !plan) {
    throw new Error(
      `Oregon PERS plan not found (apply 20260501000004_seed_oregon_pers.sql first): ${error?.message ?? "not found"}`,
    );
  }

  console.log(`Plan: ${plan.name} (${plan.id})`);
  console.log(`URL:  ${CAFR_URL}`);
  console.log(`FYE:  ${FISCAL_YEAR_END}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "oregon-pers",
    url: CAFR_URL,
    fiscalYearEnd: FISCAL_YEAR_END,
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
