import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchWithDefaults } from "@/lib/scrapers/http";
import { isAuthorizedCron } from "@/lib/scrapers/cron-shared";
import {
  getFingerprint,
  recordOutcome,
  type FingerprintStatus,
  type Outcome,
} from "@/lib/scrapers/change-detection";
import {
  MAX_PROBES_PER_RUN,
  getAdapterForPlanKey,
  isFyeWithinRecencyWindow,
  type CafrAdapter,
} from "@/lib/scrapers/cafr-adapters";
import { ingestCafr } from "@/lib/scrapers/cafr";
import { sendCafrDigest, type RunStats } from "@/lib/scrapers/cafr-digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/scrape-cafr - active CAFR auto-ingest dispatcher.
 *
 * Replaces the prior "hash the landing page" heartbeat. For every active
 * plan that has a registered adapter and is not manual_only / quarantined,
 * the dispatcher:
 *
 *   1. Calls adapter.candidateUrls(today) to get an ordered list of
 *      candidate CAFR PDF URLs.
 *   2. Filters by the 24-month recency window and the per-run probe cap.
 *   3. HEAD-probes each candidate. The first 200 + application/pdf wins.
 *   4. Calls ingestCafr to download + dedup + insert the documents row.
 *   5. Updates the plan's scrape_fingerprints row via recordOutcome,
 *      which handles the 5-outcome state machine + failure escalation.
 *
 * Outcomes per plan:
 *   - ingested:      new CAFR found and stored
 *   - deduped:       found a CAFR we already have (content_hash match)
 *   - empty:         all candidates 4xx (typical for plans pending publish)
 *   - sourceFailure: any 5xx / network error / non-PDF response
 *   - infraFailure:  ingestCafr returned an error (Allocus-side)
 *
 * Sends a weekly digest email (sub-project D will replace the
 * onboarding@resend.dev sender with alerts@allocus.com).
 */

const EXPECTED_CADENCE_HOURS = 7 * 24; // weekly heartbeat

type PlanRow = {
  id: string;
  name: string;
  scrape_config: Record<string, unknown> | null;
};

/**
 * Convert scrape_config.key (snake_case) to the storage-path key
 * (hyphenated). Used as the planKey arg to ingestCafr, which builds
 * "{key}/cafr/{hash}.pdf" inside the documents bucket.
 *
 * Most plans round-trip cleanly: "nj_doi" -> "nj-doi", "calpers" ->
 * "calpers". Michigan SMRS is the historical outlier - manual scripts
 * used "michigan-smrs" while the adapter's planKey is "michigan". The
 * dispatcher will write fresh ingests under "michigan/cafr/..."; older
 * manual-run files at "michigan-smrs/cafr/..." stay where they are.
 * Document-level content_hash dedup prevents duplicate inserts so this
 * storage-path drift is safe.
 */
function planKeyForStoragePath(scrapeConfigKey: string): string {
  return scrapeConfigKey.replace(/_/g, "-");
}

async function probePlan(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  plan: PlanRow,
  adapter: CafrAdapter,
  today: Date,
  planKey: string,
): Promise<{ outcome: Outcome; candidatesProbed: number }> {
  const candidates = adapter
    .candidateUrls(today)
    .filter((c) => isFyeWithinRecencyWindow(c.fiscalYearEnd, today))
    .slice(0, MAX_PROBES_PER_RUN);

  let firstSourceError: string | null = null;
  let probedCount = 0;

  for (const c of candidates) {
    probedCount++;

    let res: Response;
    try {
      res = await fetchWithDefaults(c.url, { method: "HEAD" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      firstSourceError ??= `network error: ${msg} on ${c.url}`;
      continue;
    }

    if (res.status >= 500) {
      firstSourceError ??= `HTTP ${res.status} on ${c.url}`;
      continue;
    }

    if (res.status >= 400) {
      // 4xx: not yet published, not a failure
      continue;
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("pdf")) {
      firstSourceError ??= `non-PDF content-type "${contentType}" on ${c.url}`;
      continue;
    }

    // 200 + PDF: ingest
    const r = await ingestCafr(supabase, {
      planId: plan.id,
      planKey: planKeyForStoragePath(planKey),
      url: c.url,
      fiscalYearEnd: c.fiscalYearEnd,
    });

    if (r.error) {
      return {
        outcome: { kind: "infraFailure", url: c.url, error: r.error },
        candidatesProbed: probedCount,
      };
    }

    if (r.inserted) {
      return {
        outcome: {
          kind: "ingested",
          url: c.url,
          fye: c.fiscalYearEnd,
          sizeBytes: r.bytes,
          documentId: r.documentId,
        },
        candidatesProbed: probedCount,
      };
    }

    if (r.skipped) {
      return {
        outcome: {
          kind: "deduped",
          url: c.url,
          fye: c.fiscalYearEnd,
          documentId: r.documentId,
        },
        candidatesProbed: probedCount,
      };
    }

    // Defensive: ingestCafr always returns one of inserted/skipped/error.
    return {
      outcome: {
        kind: "infraFailure",
        url: c.url,
        error: "ingestCafr returned unexpected shape",
      },
      candidatesProbed: probedCount,
    };
  }

  if (firstSourceError != null) {
    return {
      outcome: { kind: "sourceFailure", lastError: firstSourceError },
      candidatesProbed: probedCount,
    };
  }

  return {
    outcome: { kind: "empty", newestProbedUrl: candidates[0]?.url ?? null },
    candidatesProbed: probedCount,
  };
}

function accumulateStats(
  stats: RunStats,
  plan: PlanRow,
  outcome: Outcome,
  fingerprint: FingerprintStatus,
  newlyQuarantined: boolean,
): void {
  switch (outcome.kind) {
    case "ingested":
      stats.ingested.push({
        planName: plan.name,
        fye: outcome.fye,
        sizeBytes: outcome.sizeBytes,
        url: outcome.url,
      });
      break;
    case "deduped":
      stats.deduped.push({
        planName: plan.name,
        fye: outcome.fye,
        url: outcome.url,
      });
      break;
    case "empty":
      stats.empty.push({
        planName: plan.name,
        newestProbedUrl: outcome.newestProbedUrl,
      });
      break;
    case "sourceFailure": {
      const tier = fingerprint.consecutiveFailures;
      if (newlyQuarantined) {
        const cfg = (plan.scrape_config ?? {}) as Record<string, unknown>;
        const planKey = typeof cfg.key === "string" ? cfg.key : plan.name;
        stats.newlyQuarantined.push({
          planName: plan.name,
          planKey,
          error: outcome.lastError,
          consecutiveFailures: tier,
        });
      } else if (tier >= 2) {
        stats.sourceFailures2plus.push({
          planName: plan.name,
          error: outcome.lastError,
          consecutiveFailures: tier,
          lastSuccessfulAt: fingerprint.lastChangedAt,
        });
      } else {
        stats.sourceFailures1.push({
          planName: plan.name,
          error: outcome.lastError,
        });
      }
      break;
    }
    case "infraFailure":
      stats.infraFailures.push({
        planName: plan.name,
        url: outcome.url,
        error: outcome.error,
      });
      break;
  }
}

function emptyRunStats(): RunStats {
  return {
    plansProbed: 0,
    skippedManualOnly: 0,
    skippedNoAdapter: 0,
    skippedQuarantined: [],
    ingested: [],
    deduped: [],
    empty: [],
    sourceFailures1: [],
    sourceFailures2plus: [],
    newlyQuarantined: [],
    infraFailures: [],
  };
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const today = new Date();
  const runStartedAt = today.toISOString();
  const stats = emptyRunStats();

  const { data: plans, error: plansErr } = await supabase
    .from("plans")
    .select("id, name, scrape_config")
    .eq("active", true);

  if (plansErr) {
    return NextResponse.json(
      { error: "plans_query_failed", detail: plansErr.message },
      { status: 500 },
    );
  }

  for (const plan of (plans ?? []) as PlanRow[]) {
    const cfg = (plan.scrape_config ?? {}) as Record<string, unknown>;
    const planKey = typeof cfg.key === "string" ? cfg.key : null;
    if (!planKey) continue;

    if (cfg.manual_only === true) {
      stats.skippedManualOnly++;
      continue;
    }

    const adapter = getAdapterForPlanKey(planKey);
    if (!adapter) {
      stats.skippedNoAdapter++;
      continue;
    }

    const sourceKey = `cafr-${planKey}`;
    const fp = await getFingerprint(supabase, sourceKey);
    if (fp?.quarantinedAt) {
      stats.skippedQuarantined.push({
        planName: plan.name,
        quarantinedAt: fp.quarantinedAt,
      });
      continue;
    }

    stats.plansProbed++;

    const { outcome } = await probePlan(supabase, plan, adapter, today, planKey);

    const { fingerprint, newlyQuarantined } = await recordOutcome(
      supabase,
      sourceKey,
      outcome,
      EXPECTED_CADENCE_HOURS,
    );

    accumulateStats(stats, plan, outcome, fingerprint, newlyQuarantined);
  }

  const emailResult = await sendCafrDigest(stats, runStartedAt);

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    stats,
    emailSent: emailResult.sent,
    emailError: emailResult.error,
  });
}
