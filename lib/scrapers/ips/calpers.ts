import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestIps, resolvePlanId, type IpsIngestResult } from "./index";

export const CALPERS_IPS_URL =
  "https://www.calpers.ca.gov/docs/total-fund-investment-policy.pdf";

export async function scrapeCalPERSIPS(
  supabase: SupabaseClient,
  opts: { planId?: string } = {},
): Promise<IpsIngestResult> {
  const planId = opts.planId ?? (await resolvePlanId(supabase, "CalPERS"));
  return ingestIps(supabase, {
    planId,
    planKey: "calpers",
    planName: "CalPERS",
    url: CALPERS_IPS_URL,
  });
}
