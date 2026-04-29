import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeOregonPressReleases } from "@/lib/scrapers/press-release/oregon";
import { runScrapeCron, summarizeStringList } from "@/lib/scrapers/cron-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runScrapeCron(request, {
    sourceKey: "press_release:oregon",
    expectedCadenceHours: 24,
    work: async () => {
      const supabase = createSupabaseAdminClient();
      const { data: plan } = await supabase
        .from("plans")
        .select("id")
        .eq("name", "Oregon PERS")
        .maybeSingle();
      if (!plan) {
        return {
          hashHint: null,
          inserted: 0,
          skipped: 0,
          errors: [{ message: "plan 'Oregon PERS' not found" }],
          summary: "plan not found",
        };
      }
      const r = await scrapeOregonPressReleases(supabase, {
        planId: plan.id,
      });
      return {
        hashHint: summarizeStringList(r.insertedUrls),
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
        summary: `releases=${r.releasesFound} inserted=${r.inserted} skipped=${r.skipped} errs=${r.errors.length}`,
      };
    },
  });
}
