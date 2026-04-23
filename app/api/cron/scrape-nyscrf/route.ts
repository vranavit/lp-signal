import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeNYSCRF } from "@/lib/scrapers/nyscrf";
import { runScrapeCron } from "@/lib/scrapers/cron-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runScrapeCron(request, {
    sourceKey: "nyscrf",
    expectedCadenceHours: 24,
    work: async () => {
      const supabase = createSupabaseAdminClient();
      const { data: plan } = await supabase
        .from("plans")
        .select("id")
        .eq("name", "New York State Common Retirement Fund")
        .maybeSingle();
      if (!plan) {
        return {
          hashHint: null,
          inserted: 0,
          skipped: 0,
          errors: [{ message: "plan 'NYSCRF' not found" }],
          summary: "plan not found",
        };
      }
      const r = await scrapeNYSCRF(supabase, { planId: plan.id });
      return {
        hashHint: `nyscrf:fetched=${r.pdfsFetched}:inserted=${r.inserted}:skipped=${r.skipped}`,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
        summary: `fetched=${r.pdfsFetched} inserted=${r.inserted} skipped=${r.skipped} errs=${r.errors.length}`,
      };
    },
  });
}
