/**
 * Ingest the CalPERS PERF Annual Comprehensive Financial Report (ACFR).
 *
 * Updated 2026-04-26: switched from the Annual Investment Report to the full
 * ACFR (acfr-2025, 30.4 MB raw, FY ending 2025-06-30). The earlier
 * AIR-as-fallback workaround predates the Files API path landed in 2dc1d09 —
 * with that path live, the 30.4 MB ACFR routes through Anthropic's Files API
 * automatically when base64 inflation pushes it past the 32 MB inline ceiling.
 *
 * The full ACFR matters because the prior CalPERS allocation snapshot in the
 * DB came from 202411-invest-agenda-item04c-01-a (a CERBT Strategy 1 SAA
 * review, $20B AUM, no PE / Infra / Credit) — a workaround from before Files
 * API support. PERF is ~$500B with the full PE / Infra / Credit / RE / Public
 * Equity / Fixed Income / Cash mix. See docs/audits/duplicate-allocations-
 * audit-2026-04-25.md "Issue C" findings for the diagnosis.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const CAFR_URL =
  "https://www.calpers.ca.gov/documents/acfr-2025/download?inline";
const FISCAL_YEAR_END = "2025-06-30"; // CalPERS FY ends June 30.

async function main() {
  const supabase = createSupabaseAdminClient();
  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "CalPERS")
    .single();
  if (error || !plan) throw new Error(`CalPERS not found: ${error?.message}`);

  console.log(`Plan: ${plan.name} (${plan.id})`);
  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "calpers",
    url: CAFR_URL,
    fiscalYearEnd: FISCAL_YEAR_END,
  });
  print(r);
}

function print(r: ReturnType<typeof ingestCafr> extends Promise<infer T> ? T : never) {
  console.log(`URL:       ${r.url}`);
  console.log(`Fetched:   ${r.fetched}`);
  console.log(`Inserted:  ${r.inserted}`);
  console.log(`Skipped:   ${r.skipped}`);
  console.log(`Bytes:     ${(r.bytes / 1024 / 1024).toFixed(1)} MB`);
  if (r.error) console.log(`Error:     ${r.error}`);
  if (r.documentId) console.log(`DocumentId:${r.documentId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
