import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapePAPsers } from "@/lib/scrapers/pa-psers";
import { runScrapeCron } from "@/lib/scrapers/cron-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runScrapeCron(request, {
    sourceKey: "psers",
    expectedCadenceHours: 24,
    work: async () => {
      const supabase = createSupabaseAdminClient();
      const { data: plan } = await supabase
        .from("plans")
        .select("id")
        .eq("name", "PA PSERS")
        .maybeSingle();
      if (!plan) {
        return {
          hashHint: null,
          inserted: 0,
          skipped: 0,
          errors: [{ message: "plan 'PA PSERS' not found" }],
          summary: "plan not found",
        };
      }
      const r = await scrapePAPsers(supabase, { planId: plan.id });
      return {
        hashHint: `psers:fetched=${r.pdfsFetched}:inserted=${r.inserted}:skipped=${r.skipped}`,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
        summary: `fetched=${r.pdfsFetched} inserted=${r.inserted} skipped=${r.skipped} errs=${r.errors.length}`,
      };
    },
  });
}
