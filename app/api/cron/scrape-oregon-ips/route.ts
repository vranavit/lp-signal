import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeOregonIPS } from "@/lib/scrapers/ips/oregon";
import { runScrapeCron } from "@/lib/scrapers/cron-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runScrapeCron(request, {
    sourceKey: "ips:oregon",
    expectedCadenceHours: 168,
    work: async () => {
      const supabase = createSupabaseAdminClient();
      const r = await scrapeOregonIPS(supabase);
      return {
        hashHint: r.textHash,
        inserted: r.inserted ? 1 : 0,
        skipped: r.skipped ? 1 : 0,
        errors: r.error ? [{ url: r.url, message: r.error }] : [],
        summary: r.error
          ? `error: ${r.error}`
          : r.inserted
            ? `inserted text_len=${r.textLength} bytes=${r.bytes}`
            : r.skipped
              ? `skipped (text unchanged)`
              : "no-op",
      };
    },
  });
}
