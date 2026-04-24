import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scrapeOregon } from "@/lib/scrapers/oregon";
import { scrapeMaPrim } from "@/lib/scrapers/ma-prim";
import { scrapeVrs } from "@/lib/scrapers/vrs";
import { scrapeNjDoi } from "@/lib/scrapers/nj-doi";
import { scrapeLacera } from "@/lib/scrapers/lacera";
import { scrapeMinnesotaSbi } from "@/lib/scrapers/minnesota-sbi";
import {
  isAuthorizedCron,
  type CronWorkResult,
} from "@/lib/scrapers/cron-shared";
import { computeContentHash, recordHash } from "@/lib/scrapers/change-detection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Fan-out cron for Day-10-Session-2 pension additions (Oregon PERS /
 * Massachusetts PRIM). Consolidated into one endpoint to keep the total
 * vercel.json cron count at ≤ 15 — the Session 1 per-source pattern would
 * push us over the limit.
 *
 * Both scrapers run serially here; total runtime fits within the 300s
 * maxDuration budget given each completes in under a minute on typical
 * days (small candidate windows, content-hash dedup short-circuits on
 * unchanged days).
 *
 * Each scraper independently records a fingerprint row — health-check
 * and /admin/ingestion see per-source status, not a combined row.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = createSupabaseAdminClient();

  const results: Array<{
    sourceKey: string;
    ok: boolean;
    inserted: number;
    summary: string;
    error?: string;
  }> = [];

  for (const def of SUB_SCRAPERS) {
    try {
      const { data: plan } = await supabase
        .from("plans")
        .select("id")
        .eq("scrape_config->>key", def.sourceKey)
        .maybeSingle();
      if (!plan) {
        results.push({
          sourceKey: def.sourceKey,
          ok: false,
          inserted: 0,
          summary: "plan not seeded",
          error: "plan_missing",
        });
        await recordHash(supabase, def.sourceKey, {
          hash: null,
          changed: false,
          ok: false,
          summary: "plan not seeded",
          expectedCadenceHours: 24,
        }).catch(() => {});
        continue;
      }

      const work: CronWorkResult = await def.run(plan.id);
      const hash = work.hashHint ? computeContentHash(work.hashHint) : null;

      await recordHash(supabase, def.sourceKey, {
        hash,
        changed: work.inserted > 0,
        ok: work.errors.length === 0,
        summary: work.summary.slice(0, 500),
        expectedCadenceHours: 24,
      });

      results.push({
        sourceKey: def.sourceKey,
        ok: work.errors.length === 0,
        inserted: work.inserted,
        summary: work.summary,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        sourceKey: def.sourceKey,
        ok: false,
        inserted: 0,
        summary: `threw: ${msg}`,
        error: msg,
      });
      await recordHash(supabase, def.sourceKey, {
        hash: null,
        changed: false,
        ok: false,
        summary: `threw: ${msg}`,
        expectedCadenceHours: 24,
      }).catch(() => {});
    }
  }

  return NextResponse.json({
    ok: results.every((r) => r.ok),
    ranAt: new Date().toISOString(),
    results,
  });
}

// Bind each source key to its scraper. Add new pension scrapers here —
// the fan-out pattern keeps Vercel cron usage constant as coverage grows.
const SUB_SCRAPERS: Array<{
  sourceKey: string;
  run: (planId: string) => Promise<CronWorkResult>;
}> = [
  {
    sourceKey: "oregon_pers",
    run: async (planId: string) => {
      const supabase = createSupabaseAdminClient();
      const r = await scrapeOregon(supabase, { planId, maxPdfs: 20 });
      return {
        hashHint: `oregon:cands=${r.candidatesFound}:inserted=${r.inserted}:skipped=${r.skipped}`,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
        summary: `cands=${r.candidatesFound} fetched=${r.pdfsFetched} inserted=${r.inserted} skipped=${r.skipped} errs=${r.errors.length}`,
      };
    },
  },
  {
    sourceKey: "ma_prim",
    run: async (planId: string) => {
      const supabase = createSupabaseAdminClient();
      const r = await scrapeMaPrim(supabase, { planId, monthsBack: 18 });
      return {
        hashHint: `ma_prim:probed=${r.candidateUrlsProbed}:found=${r.pdfsFound}:inserted=${r.inserted}`,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
        summary: `probed=${r.candidateUrlsProbed} found=${r.pdfsFound} inserted=${r.inserted} skipped=${r.skipped} notfound=${r.notFound} errs=${r.errors.length}`,
      };
    },
  },
  {
    sourceKey: "vrs",
    run: async (planId: string) => {
      const supabase = createSupabaseAdminClient();
      const r = await scrapeVrs(supabase, { planId, maxPdfs: 20 });
      return {
        hashHint: `vrs:cands=${r.candidatesFound}:inserted=${r.inserted}:skipped=${r.skipped}`,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
        summary: `cands=${r.candidatesFound} fetched=${r.pdfsFetched} inserted=${r.inserted} skipped=${r.skipped} errs=${r.errors.length}`,
      };
    },
  },
  {
    sourceKey: "nj_doi",
    run: async (planId: string) => {
      const supabase = createSupabaseAdminClient();
      const r = await scrapeNjDoi(supabase, { planId, maxPdfs: 20 });
      return {
        hashHint: `nj_doi:cands=${r.candidatesFound}:inserted=${r.inserted}:skipped=${r.skipped}`,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
        summary: `cands=${r.candidatesFound} fetched=${r.pdfsFetched} inserted=${r.inserted} skipped=${r.skipped} errs=${r.errors.length}`,
      };
    },
  },
  {
    sourceKey: "lacera",
    run: async (planId: string) => {
      const supabase = createSupabaseAdminClient();
      const r = await scrapeLacera(supabase, {
        planId,
        monthsBack: 18,
        maxCandidates: 300,
      });
      return {
        hashHint: `lacera:idx=${r.indexCandidates}:probe=${r.probeCandidates}:inserted=${r.inserted}`,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
        summary: `idx=${r.indexCandidates} probe=${r.probeCandidates} probed=${r.candidateUrlsProbed} fetched=${r.pdfsFetched} inserted=${r.inserted} notfound=${r.notFound} errs=${r.errors.length}`,
      };
    },
  },
  {
    sourceKey: "minnesota_sbi",
    run: async (planId: string) => {
      const supabase = createSupabaseAdminClient();
      const r = await scrapeMinnesotaSbi(supabase, { planId, maxPdfs: 20 });
      return {
        hashHint: `minnesota_sbi:cands=${r.candidatesFound}:inserted=${r.inserted}:skipped=${r.skipped}`,
        inserted: r.inserted,
        skipped: r.skipped,
        errors: r.errors,
        summary: `cands=${r.candidatesFound} fetched=${r.pdfsFetched} inserted=${r.inserted} skipped=${r.skipped} errs=${r.errors.length}`,
      };
    },
  },
];
