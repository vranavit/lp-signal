import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeGpPressReleases } from "@/lib/scrapers/gp-press-release";
import { blackstoneConfig } from "@/lib/scrapers/blackstone";
import { runScrapeCron, summarizeStringList } from "@/lib/scrapers/cron-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runScrapeCron(request, {
    sourceKey: "blackstone",
    expectedCadenceHours: 24,
    work: async () => {
      const supabase = createSupabaseAdminClient();
      const r = await scrapeGpPressReleases(supabase, blackstoneConfig, {
        daysBack: 90,
        maxKept: 20,
        maxProbed: 50,
      });
      const insertedUrls = r.inserted.map((a) => a.url);
      return {
        hashHint: summarizeStringList(insertedUrls) || `idx:${r.found}`,
        inserted: r.kept,
        skipped: r.skipped_duplicate,
        errors: r.errors,
        summary: `found=${r.found} processed=${r.processed} kept=${r.kept} dup=${r.skipped_duplicate} old=${r.filtered_old} short=${r.filtered_too_short} no_kw=${r.filtered_no_keywords} errs=${r.errors.length}`,
      };
    },
  });
}
