import type { SupabaseClient } from "@supabase/supabase-js";
import { scrapeCalPERS } from "./calpers";
import { scrapeNYSCRF } from "./nyscrf";
import { scrapeWSIB } from "./wsib";
import { scrapeMichigan } from "./michigan";
import { scrapePAPsers } from "./pa-psers";

export { scrapeCalPERS } from "./calpers";
export { scrapeNYSCRF, nyscrfMonthCandidates } from "./nyscrf";
export { scrapeWSIB, discoverPmcCandidates } from "./wsib";
export { scrapeMichigan, discoverMichiganReports } from "./michigan";
export { scrapePAPsers, generatePsersMeetingCandidates } from "./pa-psers";

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
    case "nyscrf": {
      const r = await scrapeNYSCRF(supabase, { planId: plan.id });
      return {
        ...base,
        pdfsFound: r.pdfsFetched,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
      };
    }
    case "wsib": {
      const r = await scrapeWSIB(supabase, { planId: plan.id });
      return {
        ...base,
        pdfsFound: r.pdfsFetched,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
      };
    }
    case "michigan": {
      const r = await scrapeMichigan(supabase, { planId: plan.id });
      return {
        ...base,
        pdfsFound: r.pdfsFetched,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
      };
    }
    case "pa_psers": {
      const r = await scrapePAPsers(supabase, { planId: plan.id });
      return {
        ...base,
        pdfsFound: r.pdfsFetched,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
      };
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
