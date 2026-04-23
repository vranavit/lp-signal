import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeCalSTRS } from "@/lib/scrapers/calstrs";
import { runScrapeCron } from "@/lib/scrapers/cron-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runScrapeCron(request, {
    sourceKey: "calstrs",
    expectedCadenceHours: 24,
    work: async () => {
      const supabase = createSupabaseAdminClient();
      const { data: plan } = await supabase
        .from("plans")
        .select("id")
        .eq("name", "CalSTRS")
        .maybeSingle();
      if (!plan) {
        return {
          hashHint: null,
          inserted: 0,
          skipped: 0,
          errors: [{ message: "plan 'CalSTRS' not found" }],
          summary: "plan not found",
        };
      }
      const r = await scrapeCalSTRS(supabase, { planId: plan.id });
      return {
        hashHint: `calstrs:found=${r.pdfsFound}:inserted=${r.inserted}:skipped=${r.skipped}`,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
        summary: `meetings=${r.meetingsConsidered} pdfs=${r.pdfsFound} inserted=${r.inserted} skipped=${r.skipped} errs=${r.errors.length}`,
      };
    },
  });
}
