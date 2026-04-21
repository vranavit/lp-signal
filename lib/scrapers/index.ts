import type { SupabaseClient } from "@supabase/supabase-js";
import { scrapeCalPERS } from "./calpers";

export type ScrapeResultSummary = {
  plan: string;
  key: string;
  pdfsFound: number;
  inserted: number;
  skipped: number;
  errors: { url: string; message: string }[];
};

/**
 * Dispatches to the right scraper based on the plan's scrape_config.key.
 * Phase 1 implements only 'calpers'; others throw an "unimplemented" result
 * so the caller can still log them without the whole job failing.
 */
export async function runScraperForPlan(
  supabase: SupabaseClient,
  plan: {
    id: string;
    name: string;
    scrape_config: Record<string, unknown> | null;
  },
): Promise<ScrapeResultSummary> {
  const key = (plan.scrape_config?.key as string | undefined) ?? "unknown";
  const base: Omit<ScrapeResultSummary, "pdfsFound" | "inserted" | "skipped" | "errors"> =
    { plan: plan.name, key };

  switch (key) {
    case "calpers": {
      const r = await scrapeCalPERS(supabase, { planId: plan.id });
      return { ...base, ...r };
    }
    default:
      return {
        ...base,
        pdfsFound: 0,
        inserted: 0,
        skipped: 0,
        errors: [
          { url: "", message: `scraper not implemented for key '${key}' (Phase 3)` },
        ],
      };
  }
}
