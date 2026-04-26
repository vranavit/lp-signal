import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  privateMarketsUnfundedUsd,
  PRIVATE_MARKETS_CLASSES,
  unfundedUsd,
} from "@/lib/relevance/unfunded";
import { resolvePlanAum } from "@/lib/relevance/plan-aum";
import { TopNav } from "@/components/landing/top-nav";
import { Hero } from "@/components/landing/hero";
import { ProductExplanation } from "@/components/landing/product-explanation";
import { HowItWorks } from "@/components/landing/how-it-works";
import { DashboardPreview } from "@/components/landing/dashboard-preview";
import { AuditTrail } from "@/components/landing/audit-trail";
import { Faq } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";
import type {
  AuditExample,
  CompactSignal,
  GpSignal,
  LiveStats,
  OutreachPreviewRow,
  PipelineCounts,
  PolicyChangeRow,
  UnderweightRow,
} from "@/components/landing/shared";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const authClient = createSupabaseServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  const db = createSupabaseAdminClient();

  const [
    stats,
    calstrs,
    recentPolicyChanges,
    auditExample,
    heroSignals,
    pipelineCounts,
    outreachPreview,
    latestGpSignal,
  ] = await Promise.all([
    loadLiveStats(db),
    loadCalstrsUnderweight(db),
    loadRecentPolicyChanges(db),
    loadAuditExample(db),
    loadRecentSignalsCompact(db, 3),
    loadPipelineCounts(db),
    loadOutreachPreview(db),
    loadLatestGpSignal(db),
  ]);

  const latestPolicyChange = recentPolicyChanges[0] ?? null;
  const renderedAt = new Date();

  return (
    <div className="min-h-screen text-[rgb(10,10,10)] bg-white">
      <TopNav authenticated={!!user} />
      <main>
        <Hero
          stats={stats}
          heroSignals={heroSignals}
          pipeline={pipelineCounts}
          renderedAt={renderedAt}
        />
        <ProductExplanation
          calstrsRows={calstrs.top3}
          calstrsUnfundedPmTotal={calstrs.unfundedPmTotal}
          latestPolicyChange={latestPolicyChange}
          latestGpSignal={latestGpSignal}
        />
        <HowItWorks pipeline={pipelineCounts} />
        <DashboardPreview
          calstrsRows={calstrs.top3}
          outreach={outreachPreview}
        />
        <AuditTrail example={auditExample} />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}

// ─── data loaders ──────────────────────────────────────────────────────────

async function loadLiveStats(supabase: SupabaseClient): Promise<LiveStats> {
  try {
    // Pensions monitored = distinct plan_id across validated signals UNION
    // pension_allocations. Allocations alone excludes pensions whose only
    // data is board-minutes signals (Michigan, NYSTRS, PSERS, Oregon, MA
    // PRIM). Signals alone excludes allocations-only plans (TRS Texas,
    // Wisconsin SWIB, TRS Illinois). See session-2 diagnostic for the gap
    // analysis.
    //
    // Reads the rollup view so sub-sleeve sub-sleeve duplicates (NYSTRS
    // Public Equity Domestic + International, etc.) collapse to one row
    // per (plan, asset_class) and the headline math is honest.
    const [
      { data: allocRows, error: allocErr },
      { count: signalsCount, error: signalsErr },
      { data: signalPlanRows, error: signalPlansErr },
    ] = await Promise.all([
      supabase
        .from("pension_allocations_rollup")
        .select(
          "plan_id, asset_class, target_pct, target_min_pct, target_max_pct, actual_pct, total_plan_aum_usd, as_of_date",
        ),
      supabase
        .from("signals")
        .select("id", { count: "exact", head: true })
        .eq("seed_data", false)
        .not("validated_at", "is", null),
      supabase
        .from("signals")
        .select("plan_id")
        .eq("seed_data", false)
        .not("validated_at", "is", null)
        .not("plan_id", "is", null),
    ]);
    if (allocErr) throw allocErr;
    if (signalsErr) throw signalsErr;
    if (signalPlansErr) throw signalPlansErr;

    const rows = (allocRows ?? []) as Array<{
      plan_id: string;
      asset_class: string;
      target_pct: number;
      target_min_pct: number | null;
      target_max_pct: number | null;
      actual_pct: number | null;
      total_plan_aum_usd: number | null;
      as_of_date: string;
    }>;
    const byPlan = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!byPlan.has(r.plan_id)) byPlan.set(r.plan_id, []);
      byPlan.get(r.plan_id)!.push(r);
    }
    let unfundedTotal = 0;
    let pensionsWithActuals = 0;
    let pensionsTargetOnly = 0;
    for (const list of byPlan.values()) {
      // Rollup view already returns the latest snapshot per (plan,
      // asset_class) -- no JS-side filtering needed. unfundedUsd is
      // range-aware (only treats below-min as deployment opportunity).
      const pm = list.filter((r) =>
        (PRIVATE_MARKETS_CLASSES as readonly string[]).includes(r.asset_class),
      );
      // Completeness: a plan is "with actuals" only if every PM row in its
      // latest snapshot has actual_pct set. One NULL tips it to "target
      // only" so the caption can't overstate coverage.
      const anyActualMissing = pm.some((r) => r.actual_pct == null);
      if (pm.length > 0) {
        if (anyActualMissing) pensionsTargetOnly++;
        else pensionsWithActuals++;
      }
      unfundedTotal += privateMarketsUnfundedUsd(list);
    }

    const trackedPlanIds = new Set<string>(byPlan.keys());
    for (const r of (signalPlanRows ?? []) as Array<{ plan_id: string | null }>) {
      if (r.plan_id) trackedPlanIds.add(r.plan_id);
    }

    return {
      unfundedTotal,
      signalsCount: signalsCount ?? 0,
      pensionsMonitored: trackedPlanIds.size,
      pensionsWithActuals,
      pensionsTargetOnly,
    };
  } catch (err) {
    console.error("[landing] loadLiveStats failed:", err);
    return {
      unfundedTotal: null,
      signalsCount: null,
      pensionsMonitored: null,
      pensionsWithActuals: 0,
      pensionsTargetOnly: 0,
    };
  }
}

async function loadCalstrsUnderweight(
  supabase: SupabaseClient,
): Promise<{ top3: UnderweightRow[]; unfundedPmTotal: number }> {
  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("name", "CalSTRS")
    .maybeSingle();
  if (!plan) return { top3: [], unfundedPmTotal: 0 };
  // Rollup view returns one row per (plan, asset_class) from the latest
  // CAFR snapshot, so sub-sleeves don't duplicate the underweight ranking.
  // Range columns surface only when the asset_class has a single sub-sleeve
  // (target_min_pct / target_max_pct don't aggregate); the underweight
  // ranking uses the same range-aware unfundedUsd helper as the hero math.
  const { data } = await supabase
    .from("pension_allocations_rollup")
    .select(
      "asset_class, target_pct, target_min_pct, target_max_pct, actual_pct, total_plan_aum_usd, as_of_date",
    )
    .eq("plan_id", plan.id);
  const rows = (data ?? []) as Array<{
    asset_class: string;
    target_pct: number;
    target_min_pct: number | null;
    target_max_pct: number | null;
    actual_pct: number | null;
    total_plan_aum_usd: number | null;
    as_of_date: string;
  }>;
  if (rows.length === 0) return { top3: [], unfundedPmTotal: 0 };
  const unfundedPmTotal = privateMarketsUnfundedUsd(rows);
  const underweight = rows
    .map((r) => ({
      asset_class: r.asset_class,
      target_pct: Number(r.target_pct),
      actual_pct: r.actual_pct == null ? null : Number(r.actual_pct),
      unfunded_usd: unfundedUsd(r),
    }))
    .filter((r) => r.unfunded_usd > 0 && r.actual_pct != null)
    .sort((a, b) => b.unfunded_usd - a.unfunded_usd)
    .slice(0, 3) as UnderweightRow[];
  return { top3: underweight, unfundedPmTotal };
}

async function loadRecentPolicyChanges(
  supabase: SupabaseClient,
): Promise<PolicyChangeRow[]> {
  const { data } = await supabase
    .from("allocation_policy_changes")
    .select(
      "asset_class, previous_target_pct, new_target_pct, change_direction, change_pp, implied_usd_delta, as_of_date_new, plan:plans(name)",
    )
    .order("as_of_date_new", { ascending: false })
    .order("detected_at", { ascending: false })
    .limit(3);
  return ((data ?? []) as unknown as Array<{
    asset_class: string;
    previous_target_pct: number;
    new_target_pct: number;
    change_direction: string;
    change_pp: number;
    implied_usd_delta: number | null;
    as_of_date_new: string;
    plan: { name: string } | null;
  }>).map((r) => ({
    plan_name: r.plan?.name ?? "(unknown plan)",
    asset_class: r.asset_class,
    previous_target_pct: Number(r.previous_target_pct),
    new_target_pct: Number(r.new_target_pct),
    change_direction: r.change_direction,
    change_pp: Number(r.change_pp),
    implied_usd_delta:
      r.implied_usd_delta == null ? null : Number(r.implied_usd_delta),
    as_of_date_new: r.as_of_date_new,
  }));
}

async function loadAuditExample(
  supabase: SupabaseClient,
): Promise<AuditExample | null> {
  const { data } = await supabase
    .from("signals")
    .select(
      "summary, source_quote, source_page, asset_class, commitment_amount_usd, plan:plans(name), document:documents(document_type, meeting_date)",
    )
    .eq("seed_data", false)
    .eq("preliminary", false)
    .eq("signal_type", 1)
    .not("source_quote", "is", null)
    .gte("confidence", 0.9)
    .order("confidence", { ascending: false })
    .order("priority_score", { ascending: false })
    .limit(20);
  const rows = (data ?? []) as unknown as Array<{
    summary: string;
    source_quote: string;
    source_page: number | null;
    asset_class: string | null;
    commitment_amount_usd: number | null;
    plan: { name: string } | null;
    document: { document_type: string; meeting_date: string | null } | null;
  }>;
  const preferred =
    rows.find((r) => r.document?.document_type === "board_minutes") ?? rows[0];
  if (!preferred) return null;
  return {
    summary: preferred.summary,
    source_quote: preferred.source_quote,
    source_page: preferred.source_page,
    plan_name: preferred.plan?.name ?? null,
    doc_type: preferred.document?.document_type ?? "document",
    meeting_date: preferred.document?.meeting_date ?? null,
    commitment_amount_usd: preferred.commitment_amount_usd,
    asset_class: preferred.asset_class,
  };
}

async function loadRecentSignalsCompact(
  supabase: SupabaseClient,
  limit: number,
): Promise<CompactSignal[]> {
  const { data } = await supabase
    .from("signals")
    .select(
      "id, asset_class, summary, commitment_amount_usd, created_at, plan:plans(name), gp:gps(name), document:documents(meeting_date)",
    )
    .eq("seed_data", false)
    .not("validated_at", "is", null)
    .eq("signal_type", 1)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as Array<{
    id: string;
    asset_class: string | null;
    summary: string;
    commitment_amount_usd: number | null;
    created_at: string;
    plan: { name: string } | null;
    gp: { name: string } | null;
    document: { meeting_date: string | null } | null;
  }>).map((r) => ({
    id: r.id,
    plan_name: r.plan?.name ?? null,
    gp_name: r.gp?.name ?? null,
    asset_class: r.asset_class,
    summary: r.summary,
    commitment_amount_usd: r.commitment_amount_usd,
    meeting_date: r.document?.meeting_date ?? null,
    created_at: r.created_at,
  }));
}

async function loadPipelineCounts(
  supabase: SupabaseClient,
): Promise<PipelineCounts> {
  const [docs, signals, allocations, policyChanges] = await Promise.all([
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("processing_status", "complete"),
    supabase
      .from("signals")
      .select("id", { count: "exact", head: true })
      .eq("seed_data", false)
      .not("validated_at", "is", null),
    supabase
      .from("pension_allocations_rollup")
      .select("plan_id", { count: "exact", head: true }),
    supabase
      .from("allocation_policy_changes")
      .select("id", { count: "exact", head: true }),
  ]);
  return {
    documents: docs.count ?? 0,
    signals: signals.count ?? 0,
    allocations: allocations.count ?? 0,
    policyChanges: policyChanges.count ?? 0,
  };
}

async function loadOutreachPreview(
  supabase: SupabaseClient,
): Promise<OutreachPreviewRow[]> {
  // Rollup view: one row per (plan, asset_class) from the latest snapshot.
  // Range columns let unfundedUsd treat in-range allocations as zero rather
  // than overstating "unfunded budget" with naive (target - actual).
  const { data } = await supabase
    .from("pension_allocations_rollup")
    .select(
      "plan_id, asset_class, target_pct, target_min_pct, target_max_pct, actual_pct, total_plan_aum_usd, as_of_date, plan:plans(id, name, country, scrape_config)",
    )
    .eq("preliminary", false);
  const rows = (data ?? []) as unknown as Array<{
    plan_id: string;
    asset_class: string;
    target_pct: number;
    target_min_pct: number | null;
    target_max_pct: number | null;
    actual_pct: number | null;
    total_plan_aum_usd: number | null;
    as_of_date: string;
    plan: {
      id: string;
      name: string;
      country: string;
      scrape_config: Record<string, unknown> | null;
    } | null;
  }>;
  const byPlan = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byPlan.has(r.plan_id)) byPlan.set(r.plan_id, []);
    byPlan.get(r.plan_id)!.push(r);
  }
  const out: OutreachPreviewRow[] = [];
  for (const [, list] of byPlan) {
    const total = privateMarketsUnfundedUsd(list);
    if (total <= 0 || !list[0].plan) continue;
    const slug =
      typeof list[0].plan.scrape_config === "object" &&
      list[0].plan.scrape_config
        ? ((list[0].plan.scrape_config as Record<string, unknown>).key as
            | string
            | undefined) ?? null
        : null;
    out.push({
      plan_id: list[0].plan.id,
      plan_name: list[0].plan.name,
      country: list[0].plan.country,
      unfunded_usd: total,
      slug,
    });
  }
  out.sort((a, b) => b.unfunded_usd - a.unfunded_usd);
  return out.slice(0, 5);
}

async function loadLatestGpSignal(
  supabase: SupabaseClient,
): Promise<GpSignal | null> {
  const { data } = await supabase
    .from("signals")
    .select(
      "id, asset_class, summary, commitment_amount_usd, created_at, gp:gps(name)",
    )
    .eq("seed_data", false)
    .not("validated_at", "is", null)
    .eq("signal_type", 1)
    .not("gp_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    asset_class: string | null;
    summary: string;
    commitment_amount_usd: number | null;
    created_at: string;
    gp: { name: string } | null;
  }>;
  const r = rows[0];
  if (!r || !r.gp) return null;
  return {
    id: r.id,
    gp_name: r.gp.name,
    asset_class: r.asset_class,
    summary: r.summary,
    commitment_amount_usd: r.commitment_amount_usd,
    created_at: r.created_at,
  };
}
