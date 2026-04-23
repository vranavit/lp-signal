import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchWithDefaults } from "@/lib/scrapers/http";
import {
  computeContentHash,
  recordHash,
  getFingerprint,
} from "@/lib/scrapers/change-detection";
import { isAuthorizedCron } from "@/lib/scrapers/cron-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Weekly CAFR heartbeat. New CAFRs publish annually with a 6-12 month lag,
 * so automated daily checking would burn infra for no signal. Once a week
 * we hit each CAFR-producing plan's landing page, hash it, and fingerprint
 * it as `cafr-<key>`. When a hash changes (new CAFR posted or page
 * redesign), the health-check cron and /admin/ingestion surface the diff
 * so a human can kick off the corresponding `scripts/scrape-cafr-*.ts`.
 *
 * Auto-ingestion is deferred to Phase 4+ because it requires per-plan
 * URL curation that's hard to do safely without a human in the loop.
 */

type PlanProbe = {
  sourceKey: string;
  url: string;
  planName: string;
};

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = createSupabaseAdminClient();

  const { data: plans } = await supabase
    .from("plans")
    .select("name, scrape_config, scrape_url")
    .eq("active", true);

  const probes: PlanProbe[] = [];
  for (const p of plans ?? []) {
    const cfg = (p.scrape_config ?? {}) as Record<string, unknown>;
    const key = typeof cfg.key === "string" ? cfg.key : null;
    const website = typeof cfg.website === "string" ? cfg.website : null;
    const url = website ?? (typeof p.scrape_url === "string" ? p.scrape_url : null);
    if (!key || !url) continue;
    probes.push({
      sourceKey: `cafr-${key}`,
      url,
      planName: p.name,
    });
  }

  const results: Array<{
    sourceKey: string;
    planName: string;
    ok: boolean;
    changed: boolean;
    error?: string;
  }> = [];

  for (const probe of probes) {
    try {
      const res = await fetchWithDefaults(probe.url);
      if (!res.ok) {
        results.push({
          sourceKey: probe.sourceKey,
          planName: probe.planName,
          ok: false,
          changed: false,
          error: `HTTP ${res.status}`,
        });
        await recordHash(supabase, probe.sourceKey, {
          hash: null,
          changed: false,
          ok: false,
          summary: `fetch failed: HTTP ${res.status}`,
          expectedCadenceHours: 7 * 24,
        }).catch(() => {});
        continue;
      }
      const body = await res.text();
      const hash = computeContentHash(body);
      const fp = await getFingerprint(supabase, probe.sourceKey);
      const changed = fp?.lastHash != null && fp.lastHash !== hash;
      await recordHash(supabase, probe.sourceKey, {
        hash,
        changed: changed || fp?.lastHash == null,
        ok: true,
        summary: changed
          ? `${probe.planName} CAFR landing page changed — new CAFR may be posted. Re-run scripts/scrape-cafr-${probe.sourceKey.replace("cafr-", "")}.ts if applicable.`
          : `${probe.planName} CAFR landing page unchanged`,
        expectedCadenceHours: 7 * 24,
      });
      results.push({
        sourceKey: probe.sourceKey,
        planName: probe.planName,
        ok: true,
        changed,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        sourceKey: probe.sourceKey,
        planName: probe.planName,
        ok: false,
        changed: false,
        error: msg,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    probes: results,
  });
}
