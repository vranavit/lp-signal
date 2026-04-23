import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeWSIB } from "@/lib/scrapers/wsib";
import { runScrapeCron } from "@/lib/scrapers/cron-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runScrapeCron(request, {
    sourceKey: "wsib",
    expectedCadenceHours: 24,
    work: async () => {
      const supabase = createSupabaseAdminClient();
      const { data: plan } = await supabase
        .from("plans")
        .select("id")
        .eq("name", "Washington State Investment Board")
        .maybeSingle();
      if (!plan) {
        return {
          hashHint: null,
          inserted: 0,
          skipped: 0,
          errors: [{ message: "plan 'WSIB' not found" }],
          summary: "plan not found",
        };
      }
      const r = await scrapeWSIB(supabase, { planId: plan.id });
      return {
        hashHint: `wsib:fetched=${r.pdfsFetched}:inserted=${r.inserted}:skipped=${r.skipped}`,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
        summary: `fetched=${r.pdfsFetched} inserted=${r.inserted} skipped=${r.skipped} errs=${r.errors.length}`,
      };
    },
  });
}
