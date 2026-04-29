import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestIps, resolvePlanId, type IpsIngestResult } from "./index";

export const NYSCRF_IPS_URL =
  "https://www.osc.ny.gov/files/common-retirement-fund/pdf/general-investment-policies.pdf";

export async function scrapeNYSCRFIPS(
  supabase: SupabaseClient,
  opts: { planId?: string } = {},
): Promise<IpsIngestResult> {
  const planId =
    opts.planId ??
    (await resolvePlanId(supabase, "New York State Common Retirement Fund"));
  return ingestIps(supabase, {
    planId,
    planKey: "nyscrf",
    planName: "New York State Common Retirement Fund",
    url: NYSCRF_IPS_URL,
  });
}
