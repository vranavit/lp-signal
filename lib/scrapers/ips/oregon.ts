import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestIps, resolvePlanId, type IpsIngestResult } from "./index";

export const OREGON_IPS_URL =
  "https://www.oregon.gov/treasury/invested-for-oregon/Documents/Invested-for-OR-OIC-INV/Investment-Policy-Statement-for-OPERF.pdf";

export async function scrapeOregonIPS(
  supabase: SupabaseClient,
  opts: { planId?: string } = {},
): Promise<IpsIngestResult> {
  const planId =
    opts.planId ?? (await resolvePlanId(supabase, "Oregon PERS"));
  return ingestIps(supabase, {
    planId,
    planKey: "oregon",
    planName: "Oregon PERS",
    url: OREGON_IPS_URL,
  });
}
