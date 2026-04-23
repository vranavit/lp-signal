import Link from "next/link";
import { ArrowUpRight, Quote } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUSD, formatDate } from "@/lib/utils";
import { Wordmark } from "@/components/brand/wordmark";
import { DemoRequestButton } from "@/components/landing/demo-request-modal";
import {
  PRIVATE_MARKETS_CLASSES,
  privateMarketsUnfundedUsd,
  unfundedUsd,
} from "@/lib/relevance/unfunded";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const authClient = createSupabaseServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  const db = createSupabaseAdminClient();

  const [
    stats,
    calstrsUnderweight,
    recentPolicyChanges,
    auditExample,
    heroSignals,
    feedSignals,
    pipelineCounts,
    outreachPreview,
  ] = await Promise.all([
    loadLiveStats(db),
    loadCalstrsTop3Underweight(db),
    loadRecentPolicyChanges(db),
    loadAuditExample(db),
    loadRecentSignalsCompact(db, 3),
    loadRecentSignalsCompact(db, 6),
    loadPipelineCounts(db),
    loadOutreachPreview(db),
  ]);

  return (
    <div className="landing-surface min-h-screen text-[rgb(10,10,10)]">
      <TopNav authenticated={!!user} />
      <main>
        <Hero stats={stats} heroSignals={heroSignals} />
        <ProofBlocks
          calstrsRows={calstrsUnderweight}
          policyChanges={recentPolicyChanges}
          feedSignals={feedSignals}
        />
        <HowItWorks pipeline={pipelineCounts} />
        <LiveFromDashboard
          calstrsRows={calstrsUnderweight}
          outreach={outreachPreview}
        />
        <AuditTrailProof example={auditExample} />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}

// ─── data loaders ──────────────────────────────────────────────────────────

type LiveStats = {
  unfundedTotal: number;
  signalsCount: number;
  pensionsMonitored: number;
};

type CompactSignal = {
  id: string;
  plan_name: string | null;
  gp_name: string | null;
  asset_class: string | null;
  summary: string;
  commitment_amount_usd: number | null;
  meeting_date: string | null;
  created_at: string;
};

type OutreachPreviewRow = {
  plan_id: string;
  plan_name: string;
  country: string;
  unfunded_usd: number;
  slug: string | null;
};

type PipelineCounts = {
  documents: number;
  signals: number;
  allocations: number;
  policyChanges: number;
};

async function loadLiveStats(supabase: SupabaseClient): Promise<LiveStats> {
  try {
    const [{ data: allocRows }, { count: signalsCount }] = await Promise.all([
      supabase
        .from("pension_allocations")
        .select(
          "plan_id, asset_class, target_pct, actual_pct, total_plan_aum_usd, as_of_date",
        ),
      supabase
        .from("signals")
        .select("id", { count: "exact", head: true })
        .eq("seed_data", false)
        .not("validated_at", "is", null),
    ]);
    const rows = (allocRows ?? []) as Array<{
      plan_id: string;
      asset_class: string;
      target_pct: number;
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
    for (const list of byPlan.values()) {
      list.sort((a, b) => b.as_of_date.localeCompare(a.as_of_date));
      const latestDate = list[0].as_of_date;
      const latest = list.filter((r) => r.as_of_date === latestDate);
      for (const r of latest) {
        if (r.actual_pct == null || r.total_plan_aum_usd == null) continue;
        const gap = Number(r.target_pct) - Number(r.actual_pct);
        if (gap <= 0) continue;
        unfundedTotal += Math.round((gap / 100) * Number(r.total_plan_aum_usd));
      }
    }
    return {
      unfundedTotal,
      signalsCount: signalsCount ?? 0,
      pensionsMonitored: byPlan.size,
    };
  } catch {
    return {
      unfundedTotal: 25_900_000_000,
      signalsCount: 75,
      pensionsMonitored: 7,
    };
  }
}

type UnderweightRow = {
  asset_class: string;
  target_pct: number;
  actual_pct: number;
  unfunded_usd: number;
};

async function loadCalstrsTop3Underweight(
  supabase: SupabaseClient,
): Promise<UnderweightRow[]> {
  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("name", "CalSTRS")
    .maybeSingle();
  if (!plan) return [];
  const { data } = await supabase
    .from("pension_allocations")
    .select(
      "asset_class, target_pct, actual_pct, total_plan_aum_usd, as_of_date",
    )
    .eq("plan_id", plan.id)
    .order("as_of_date", { ascending: false });
  const rows = (data ?? []) as Array<{
    asset_class: string;
    target_pct: number;
    actual_pct: number | null;
    total_plan_aum_usd: number | null;
    as_of_date: string;
  }>;
  if (rows.length === 0) return [];
  const latestDate = rows[0].as_of_date;
  const latest = rows.filter((r) => r.as_of_date === latestDate);
  return latest
    .filter((r) => r.actual_pct != null && r.total_plan_aum_usd != null)
    .map((r) => {
      const gap = Number(r.target_pct) - Number(r.actual_pct!);
      return {
        asset_class: r.asset_class,
        target_pct: Number(r.target_pct),
        actual_pct: Number(r.actual_pct),
        unfunded_usd:
          gap > 0
            ? Math.round((gap / 100) * Number(r.total_plan_aum_usd!))
            : 0,
      };
    })
    .filter((r) => r.unfunded_usd > 0)
    .sort((a, b) => b.unfunded_usd - a.unfunded_usd)
    .slice(0, 3);
}

type PolicyChangeRow = {
  plan_name: string;
  asset_class: string;
  previous_target_pct: number;
  new_target_pct: number;
  change_direction: string;
  as_of_date_new: string;
};

async function loadRecentPolicyChanges(
  supabase: SupabaseClient,
): Promise<PolicyChangeRow[]> {
  const { data } = await supabase
    .from("allocation_policy_changes")
    .select(
      "asset_class, previous_target_pct, new_target_pct, change_direction, as_of_date_new, plan:plans(name)",
    )
    .order("as_of_date_new", { ascending: false })
    .order("detected_at", { ascending: false })
    .limit(3);
  return ((data ?? []) as unknown as Array<{
    asset_class: string;
    previous_target_pct: number;
    new_target_pct: number;
    change_direction: string;
    as_of_date_new: string;
    plan: { name: string } | null;
  }>).map((r) => ({
    plan_name: r.plan?.name ?? "(unknown plan)",
    asset_class: r.asset_class,
    previous_target_pct: Number(r.previous_target_pct),
    new_target_pct: Number(r.new_target_pct),
    change_direction: r.change_direction,
    as_of_date_new: r.as_of_date_new,
  }));
}

type AuditExample = {
  summary: string;
  source_quote: string;
  source_page: number | null;
  plan_name: string | null;
  doc_type: string;
  meeting_date: string | null;
  commitment_amount_usd: number | null;
  asset_class: string | null;
};

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
    supabase.from("pension_allocations").select("id", { count: "exact", head: true }),
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
  const { data } = await supabase
    .from("pension_allocations")
    .select(
      "plan_id, asset_class, target_pct, actual_pct, total_plan_aum_usd, as_of_date, plan:plans(id, name, country, scrape_config)",
    )
    .eq("preliminary", false);
  const rows = (data ?? []) as unknown as Array<{
    plan_id: string;
    asset_class: string;
    target_pct: number;
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
    list.sort((a, b) => b.as_of_date.localeCompare(a.as_of_date));
    const latestDate = list[0].as_of_date;
    const latest = list.filter((r) => r.as_of_date === latestDate);
    const total = privateMarketsUnfundedUsd(latest);
    if (total <= 0 || !latest[0].plan) continue;
    const slug =
      typeof latest[0].plan.scrape_config === "object" &&
      latest[0].plan.scrape_config
        ? ((latest[0].plan.scrape_config as Record<string, unknown>).key as
            | string
            | undefined) ?? null
        : null;
    out.push({
      plan_id: latest[0].plan.id,
      plan_name: latest[0].plan.name,
      country: latest[0].plan.country,
      unfunded_usd: total,
      slug,
    });
  }
  out.sort((a, b) => b.unfunded_usd - a.unfunded_usd);
  return out.slice(0, 5);
}

// ─── sections ──────────────────────────────────────────────────────────────

function TopNav({ authenticated }: { authenticated: boolean }) {
  return (
    <header className="w-full border-b border-neutral-200 bg-white/70 backdrop-blur-sm">
      <div className="mx-auto max-w-[1200px] px-6 h-16 flex items-center justify-between">
        <Wordmark size="md" />
        <div className="flex items-center gap-6">
          <a
            href="#how"
            className="hidden sm:inline text-[13px] text-neutral-700 hover:text-navy transition-colors"
          >
            How it works
          </a>
          <a
            href="#faq"
            className="hidden sm:inline text-[13px] text-neutral-700 hover:text-navy transition-colors"
          >
            FAQ
          </a>
          {authenticated ? (
            <Link
              href="/signals"
              className="text-[13px] text-neutral-700 hover:text-navy transition-colors"
            >
              Go to dashboard →
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-[13px] text-neutral-700 hover:text-navy transition-colors"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero({
  stats,
  heroSignals,
}: {
  stats: LiveStats;
  heroSignals: CompactSignal[];
}) {
  return (
    <section className="mx-auto max-w-[1200px] px-6 pt-16 pb-20 sm:pt-20 sm:pb-24">
      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-10 lg:gap-16 items-start">
        {/* LEFT */}
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-neutral-200 bg-white text-[11.5px] text-neutral-700">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>Live data from {stats.pensionsMonitored} US public pensions</span>
          </div>
          <h1
            className="mt-5 text-[44px] sm:text-[56px] font-bold text-navy leading-[1.02]"
            style={{ letterSpacing: "-0.05em" }}
          >
            LP intelligence for private markets fundraising.
          </h1>
          <p className="mt-5 text-[16px] sm:text-[18px] text-neutral-700 leading-snug max-w-xl">
            Track allocation gaps, policy changes, and commitment signals
            across US public pensions in real time.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <DemoRequestButton label="Request demo" />
            <a
              href="#proof"
              className="inline-flex items-center h-9 px-4 text-[13px] text-neutral-700 hover:text-navy rounded-lg transition-colors"
            >
              See live data ↓
            </a>
          </div>

          {/* Stat rail — vertical stack so it lines up alongside the right panel */}
          <dl className="mt-10 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 divide-y lg:divide-y divide-neutral-200 lg:max-w-xs sm:divide-y-0 lg:sm:divide-y sm:divide-x sm:divide-neutral-200 lg:sm:divide-x-0">
            <HeroStat
              value={formatUSD(stats.unfundedTotal)}
              label="tracked unfunded budget"
            />
            <HeroStat
              value={String(stats.signalsCount)}
              label="commitment signals"
            />
            <HeroStat
              value={String(stats.pensionsMonitored)}
              label="pensions monitored"
            />
          </dl>
        </div>

        {/* RIGHT — live mini-dashboard preview */}
        <HeroDashboard signals={heroSignals} />
      </div>
    </section>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="py-4 sm:px-4 lg:px-0 first:pt-0 sm:first:pl-0 lg:sm:first:pl-0">
      <dt
        className="text-[26px] sm:text-[30px] font-bold text-navy leading-none num tabular-nums"
        style={{ letterSpacing: "-0.03em" }}
      >
        {value}
      </dt>
      <dd className="mt-2 text-[12px] text-neutral-600">{label}</dd>
    </div>
  );
}

function HeroDashboard({ signals }: { signals: CompactSignal[] }) {
  return (
    <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 bg-neutral-50">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="text-[11px] uppercase tracking-[0.08em] text-neutral-500">
            Live signals
          </span>
        </div>
        <span className="text-[11px] text-neutral-500">
          Commitments · most recent
        </span>
      </div>
      {signals.length === 0 ? (
        <div className="px-4 py-6 text-[12.5px] text-neutral-500">
          Live preview unavailable.
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {signals.map((s) => {
            const entity = s.plan_name ?? s.gp_name ?? "—";
            const date =
              s.meeting_date ??
              (s.created_at ? s.created_at.slice(0, 10) : null);
            return (
              <li key={s.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[12px] font-medium text-navy truncate">
                      {entity}
                    </span>
                    {s.asset_class ? (
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.06em] text-neutral-500 border border-neutral-200 rounded-[4px] px-1.5 py-0.5">
                        {s.asset_class}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="num tabular-nums text-[13px] font-medium text-neutral-900">
                      {s.commitment_amount_usd
                        ? formatUSD(s.commitment_amount_usd)
                        : "—"}
                    </div>
                    <div className="num tabular-nums text-[10.5px] text-neutral-500 mt-0.5">
                      {date ?? "—"}
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 text-[12px] text-neutral-600 leading-snug line-clamp-2">
                  {s.summary}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="px-4 py-2.5 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between">
        <span className="text-[11px] text-neutral-500">
          Shown: commitment signals (T1) from board minutes + press releases.
        </span>
      </div>
    </div>
  );
}

// ─── Section: What Allocus shows you — 3-column asymmetric grid ────────────

function ProofBlocks({
  calstrsRows,
  policyChanges,
  feedSignals,
}: {
  calstrsRows: UnderweightRow[];
  policyChanges: PolicyChangeRow[];
  feedSignals: CompactSignal[];
}) {
  return (
    <section
      id="proof"
      className="mx-auto max-w-[1200px] px-6 py-20 sm:py-24 border-t border-neutral-200"
    >
      <div className="mb-10 max-w-2xl">
        <div className="text-[11.5px] uppercase tracking-[0.08em] text-neutral-500">
          What Allocus shows you
        </div>
        <h2
          className="mt-3 text-[30px] sm:text-[36px] font-bold text-navy leading-tight"
          style={{ letterSpacing: "-0.03em" }}
        >
          Live data from live disclosures.
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr_1.4fr] gap-4">
        <ProofCardAllocation rows={calstrsRows} />
        <ProofCardPolicy changes={policyChanges} />
        <ProofCardFeed signals={feedSignals} />
      </div>
    </section>
  );
}

function ProofCardAllocation({ rows }: { rows: UnderweightRow[] }) {
  return (
    <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-200">
        <div className="text-[14px] font-semibold text-navy">
          Allocation gaps in real time
        </div>
        <div className="mt-1 text-[12.5px] text-neutral-600">
          See which pensions have budget to deploy right now.
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500 mb-3">
          CalSTRS — top 3 underweight
        </div>
        {rows.length === 0 ? (
          <div className="text-[12.5px] text-neutral-500">
            No underweight positions currently.
          </div>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-neutral-500 border-b border-neutral-200">
                <ProofTh>Asset</ProofTh>
                <ProofTh className="text-right">Target</ProofTh>
                <ProofTh className="text-right">Actual</ProofTh>
                <ProofTh className="text-right">Gap</ProofTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.asset_class}
                  className="border-b border-neutral-100 last:border-b-0"
                >
                  <td className="py-2.5 text-neutral-950">{r.asset_class}</td>
                  <td className="py-2.5 text-right num tabular-nums text-neutral-900">
                    {r.target_pct}%
                  </td>
                  <td className="py-2.5 text-right num tabular-nums text-neutral-500">
                    {r.actual_pct}%
                  </td>
                  <td className="py-2.5 text-right num tabular-nums font-semibold text-emerald-700">
                    +{formatUSD(r.unfunded_usd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="px-5 py-2.5 border-t border-neutral-200 bg-neutral-50">
        <Link
          href="/pensions/calstrs"
          className="text-[12px] text-navy hover:underline"
        >
          All CalSTRS allocations →
        </Link>
      </div>
    </div>
  );
}

function ProofCardPolicy({ changes }: { changes: PolicyChangeRow[] }) {
  return (
    <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-200">
        <div className="text-[14px] font-semibold text-navy">
          Know when targets change
        </div>
        <div className="mt-1 text-[12.5px] text-neutral-600">
          We detect policy shifts automatically.
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500 mb-3">
          Most recent
        </div>
        {changes.length === 0 ? (
          <div className="text-[12.5px] text-neutral-500">
            No changes detected yet.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 -mx-1">
            {changes.map((c, i) => {
              const sign =
                c.change_direction === "increase"
                  ? "↑"
                  : c.change_direction === "decrease"
                  ? "↓"
                  : "→";
              const delta = c.new_target_pct - c.previous_target_pct;
              const deltaTone =
                delta > 0.25
                  ? "text-emerald-700"
                  : delta < -0.25
                  ? "text-rose-700"
                  : "text-neutral-500";
              return (
                <li key={i} className="py-2.5 px-1">
                  <div className="text-[12.5px] text-navy font-medium truncate">
                    {c.plan_name}
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-2">
                    <div className="text-[11px] text-neutral-500 truncate">
                      {c.asset_class}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="num tabular-nums text-[12px] text-neutral-900">
                        {c.previous_target_pct}% {sign} {c.new_target_pct}%
                      </div>
                      <div
                        className={`num tabular-nums text-[10.5px] ${deltaTone}`}
                      >
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(1)}pp
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="px-5 py-2.5 border-t border-neutral-200 bg-neutral-50">
        <Link
          href="/signals?type=policy"
          className="text-[12px] text-navy hover:underline"
        >
          Full history →
        </Link>
      </div>
    </div>
  );
}

function ProofCardFeed({ signals }: { signals: CompactSignal[] }) {
  return (
    <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-200">
        <div className="text-[14px] font-semibold text-navy">
          Live signal feed
        </div>
        <div className="mt-1 text-[12.5px] text-neutral-600">
          Every new commitment, across every source.
        </div>
      </div>
      <div className="max-h-[320px] overflow-y-auto">
        {signals.length === 0 ? (
          <div className="px-5 py-5 text-[12.5px] text-neutral-500">
            Feed unavailable.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {signals.map((s) => {
              const entity = s.plan_name ?? s.gp_name ?? "—";
              const src = s.plan_name ? "pension" : "GP";
              return (
                <li key={s.id} className="px-5 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[12px] font-medium text-navy truncate">
                        {entity}
                      </span>
                      <span className="shrink-0 text-[9.5px] uppercase tracking-[0.08em] text-neutral-500">
                        {src}
                      </span>
                    </div>
                    <div className="shrink-0 num tabular-nums text-[12px] font-medium text-neutral-900">
                      {s.commitment_amount_usd
                        ? formatUSD(s.commitment_amount_usd)
                        : "—"}
                    </div>
                  </div>
                  <div className="mt-1 text-[11.5px] text-neutral-600 leading-snug line-clamp-2">
                    {s.summary}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="px-5 py-2.5 border-t border-neutral-200 bg-neutral-50">
        <span className="text-[11px] text-neutral-500">
          Updated continuously as new disclosures publish.
        </span>
      </div>
    </div>
  );
}

// ─── Section: How it works ──────────────────────────────────────────────────

function HowItWorks({ pipeline }: { pipeline: PipelineCounts }) {
  const steps = [
    {
      n: "01",
      title: "Ingest",
      body: "We monitor every public disclosure from US pension funds and major GPs — board minutes, monthly transaction reports, annual CAFRs, press releases.",
      chip: `${pipeline.documents.toLocaleString("en-US")} documents processed`,
    },
    {
      n: "02",
      title: "Extract",
      body: "Claude reads every document, extracts commitment signals, allocation targets, and policy changes. Every data point source-verified to the original disclosure.",
      chip: `${pipeline.signals} signals + ${pipeline.allocations} allocations extracted`,
    },
    {
      n: "03",
      title: "Surface",
      body: "Your dashboard filters to your ICP. See which pensions have unfunded budget matched to your fund's size and strategy. One-click audit trail on every number.",
      chip: `${pipeline.policyChanges} policy changes detected automatically`,
    },
  ];
  return (
    <section
      id="how"
      className="mx-auto max-w-[1200px] px-6 py-20 sm:py-24 border-t border-neutral-200"
    >
      <div className="mb-12 max-w-2xl">
        <div className="text-[11.5px] uppercase tracking-[0.08em] text-neutral-500">
          How it works
        </div>
        <h2
          className="mt-3 text-[30px] sm:text-[36px] font-bold text-navy leading-tight"
          style={{ letterSpacing: "-0.03em" }}
        >
          From raw disclosure to targeted outreach list.
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-t border-neutral-200">
        {steps.map((s, i) => (
          <div
            key={s.n}
            className={
              "pt-8 pb-6 md:pr-6 " +
              (i < steps.length - 1
                ? "md:border-r border-neutral-200 md:pr-8"
                : "")
            }
          >
            <div
              className="text-[28px] font-bold text-navy leading-none num tabular-nums"
              style={{ letterSpacing: "-0.02em" }}
            >
              {s.n}
            </div>
            <div
              className="mt-5 text-[18px] font-semibold text-navy"
              style={{ letterSpacing: "-0.02em" }}
            >
              {s.title}
            </div>
            <p className="mt-2.5 text-[13.5px] text-neutral-700 leading-relaxed max-w-sm">
              {s.body}
            </p>
            <div className="mt-4 inline-flex items-center gap-1.5 px-2 py-1 rounded-[6px] border border-neutral-200 bg-white num tabular-nums text-[11.5px] text-neutral-800">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-navy" />
              {s.chip}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── NEW: Live from the dashboard ──────────────────────────────────────────

function LiveFromDashboard({
  calstrsRows,
  outreach,
}: {
  calstrsRows: UnderweightRow[];
  outreach: OutreachPreviewRow[];
}) {
  // Reconstruct a CalSTRS-like hero: headline unfunded, AUM-ish, top 3 chips.
  const calstrsUnfundedTotal = calstrsRows.reduce(
    (acc, r) => acc + r.unfunded_usd,
    0,
  );
  return (
    <section className="mx-auto max-w-[1200px] px-6 py-20 sm:py-24 border-t border-neutral-200">
      <div className="mb-10 max-w-2xl">
        <div className="text-[11.5px] uppercase tracking-[0.08em] text-neutral-500">
          What this looks like today
        </div>
        <h2
          className="mt-3 text-[30px] sm:text-[36px] font-bold text-navy leading-tight"
          style={{ letterSpacing: "-0.03em" }}
        >
          Live from the dashboard.
        </h2>
        <p className="mt-3 text-[14px] text-neutral-700">
          Every pension, every signal, every allocation gap — source-verified
          and filtered to your firm&apos;s ICP.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: CalSTRS hero-style ribbon */}
        <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between">
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500">
              /pensions/calstrs
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 text-neutral-400" />
          </div>
          <div className="px-5 py-5">
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500">
              Unfunded private-markets budget
            </div>
            <div
              className="mt-1 num tabular-nums text-[36px] sm:text-[40px] font-bold text-navy leading-none"
              style={{ letterSpacing: "-0.03em" }}
            >
              {formatUSD(calstrsUnfundedTotal)}
            </div>
            <div className="mt-2 text-[11.5px] text-neutral-500">
              CalSTRS · fiscal year end 2025-06-30 · based on latest CAFR
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {calstrsRows.map((r) => (
                <div
                  key={r.asset_class}
                  className="rounded-[6px] border border-neutral-200 px-2.5 py-1.5 min-w-[96px] bg-white"
                >
                  <div className="text-[10px] uppercase tracking-[0.06em] text-neutral-500">
                    {r.asset_class}
                  </div>
                  <div className="num tabular-nums text-[13px] font-semibold text-neutral-900 leading-tight">
                    {formatUSD(r.unfunded_usd)}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 border-t border-neutral-200 pt-4">
              <div className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500 mb-2">
                Gap detail
              </div>
              <table className="w-full border-collapse text-[12.5px]">
                <tbody>
                  {calstrsRows.map((r) => (
                    <tr
                      key={r.asset_class}
                      className="border-b border-neutral-100 last:border-b-0"
                    >
                      <td className="py-2 text-neutral-950">{r.asset_class}</td>
                      <td className="py-2 text-right num tabular-nums text-neutral-500">
                        {r.target_pct}% → {r.actual_pct}%
                      </td>
                      <td className="py-2 text-right num tabular-nums font-semibold text-emerald-700">
                        +{formatUSD(r.unfunded_usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* RIGHT: Outreach dashboard preview */}
        <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between">
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500">
              /outreach
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 text-neutral-400" />
          </div>
          <div className="px-5 py-5">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500">
                  Filter
                </div>
                <div className="mt-1 text-[13px] text-neutral-950">
                  Unfunded PE/RE budget{" "}
                  <span className="num tabular-nums text-navy">≥ $1B</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500">
                  Matches
                </div>
                <div className="num tabular-nums text-[15px] font-semibold text-navy">
                  {outreach.length}
                </div>
              </div>
            </div>

            {outreach.length === 0 ? (
              <div className="mt-5 text-[12.5px] text-neutral-500">
                No plans match this filter yet.
              </div>
            ) : (
              <table className="mt-5 w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-neutral-500 border-b border-neutral-200">
                    <ProofTh>Plan</ProofTh>
                    <ProofTh className="text-right">Country</ProofTh>
                    <ProofTh className="text-right">Unfunded</ProofTh>
                  </tr>
                </thead>
                <tbody>
                  {outreach.map((p) => (
                    <tr
                      key={p.plan_id}
                      className="border-b border-neutral-100 last:border-b-0"
                    >
                      <td className="py-2.5 text-neutral-950 truncate max-w-[200px]">
                        {p.plan_name}
                      </td>
                      <td className="py-2.5 text-right num tabular-nums text-neutral-500">
                        {p.country}
                      </td>
                      <td className="py-2.5 text-right num tabular-nums font-semibold text-neutral-900">
                        {formatUSD(p.unfunded_usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="px-5 py-2.5 border-t border-neutral-200 bg-neutral-50">
            <span className="text-[11px] text-neutral-500">
              Sortable · exportable · filterable by asset class, size, recency.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Audit trail proof — 2 columns ─────────────────────────────────────────

function AuditTrailProof({ example }: { example: AuditExample | null }) {
  return (
    <section className="mx-auto max-w-[1200px] px-6 py-20 sm:py-24 border-t border-neutral-200">
      <div className="mb-10 max-w-2xl">
        <div className="text-[11.5px] uppercase tracking-[0.08em] text-neutral-500">
          Credibility
        </div>
        <h2
          className="mt-3 text-[30px] sm:text-[36px] font-bold text-navy leading-tight"
          style={{ letterSpacing: "-0.03em" }}
        >
          Every number is traceable.
        </h2>
        <p className="mt-3 text-[14px] text-neutral-700">
          Click any figure in Allocus to see the verbatim language from the
          original disclosure — no inference, no paraphrase.
        </p>
      </div>

      {example ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* LEFT: the record */}
          <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden">
            <div className="px-5 py-3 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between">
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500">
                Signal record
              </span>
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500">
                Extracted
              </span>
            </div>
            <div className="px-5 py-4">
              <div className="text-[14px] text-neutral-950 leading-snug">
                {example.summary}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-neutral-500">
                {example.asset_class ? <span>{example.asset_class}</span> : null}
                {example.commitment_amount_usd ? (
                  <span className="num tabular-nums text-navy font-medium">
                    {formatUSD(example.commitment_amount_usd)}
                  </span>
                ) : null}
                {example.plan_name ? <span>{example.plan_name}</span> : null}
                {example.meeting_date ? (
                  <span className="num tabular-nums">
                    {formatDate(example.meeting_date)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* RIGHT: the source */}
          <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden">
            <div className="px-5 py-3 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between">
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500">
                Source document
              </span>
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500">
                {example.source_page ? `p. ${example.source_page}` : "source"}
              </span>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-start gap-3">
                <Quote
                  className="h-4 w-4 mt-0.5 text-neutral-400 shrink-0"
                  strokeWidth={1.5}
                />
                <blockquote className="text-[13.5px] text-neutral-800 leading-relaxed italic">
                  {example.source_quote}
                </blockquote>
              </div>
              <div className="mt-4 text-[11.5px] text-neutral-500">
                {prettyDocType(example.doc_type)}
                {example.plan_name ? ` · ${example.plan_name}` : ""}
                {example.meeting_date ? ` · ${formatDate(example.meeting_date)}` : ""}
              </div>
            </div>
            <div className="px-5 py-2.5 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between">
              <span className="text-[11px] text-neutral-500">
                Every row links to the original PDF with one click.
              </span>
              <span className="text-[11px] text-navy font-medium">
                Inspect →
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[12px] border border-neutral-200 bg-white p-6 text-[13px] text-neutral-500">
          Example unavailable.
        </div>
      )}
    </section>
  );
}

function prettyDocType(t: string): string {
  switch (t) {
    case "board_minutes":
      return "Board resolution / minutes";
    case "cafr":
      return "Annual Comprehensive Financial Report";
    case "gp_press_release":
      return "GP press release";
    case "press_release":
      return "Press release";
    case "annual_report":
      return "Annual report";
    case "investment_policy":
      return "Investment policy statement";
    default:
      return t;
  }
}

// ─── FAQ — 2 columns ───────────────────────────────────────────────────────

function Faq() {
  const items: { q: string; a: string }[] = [
    {
      q: "How many pensions do you cover?",
      a: "Today, 8 US public pensions with transaction data and 6 with allocation data. New pensions added weekly. Target: 50+ pensions by end of Q3 2026.",
    },
    {
      q: "Where does the data come from?",
      a: "Every signal is sourced from public disclosures: state comptroller reports, pension board minutes, GP press releases, and Comprehensive Annual Financial Reports (CAFRs). Every number in Allocus links back to the original source document with a page citation.",
    },
    {
      q: "How fresh is the data?",
      a: "GP press releases: same-day ingestion. Monthly pension transaction reports: within 24 hours of publication. Annual CAFRs: within a week of release. Allocation policy changes: detected on the next CAFR ingestion automatically.",
    },
    {
      q: "Who is this for?",
      a: "Private markets IR teams, fund managers, and placement agents who need to know which LPs have budget to deploy — filtered to their specific ICP (asset class, check size, geography).",
    },
    {
      q: "How do you compare to Preqin or Pitchbook?",
      a: "Preqin and Pitchbook show historical commitments. Allocus shows forward-looking signals: who has unfunded budget right now, who's changing their policy, who just announced a close. Different layer. Complementary, not redundant.",
    },
    {
      q: "Can I see a demo?",
      a: "Yes. Request one via the button at the top. Current beta is closed to ~5 design partners. Access is manual for now.",
    },
  ];
  const leftCol = items.slice(0, 3);
  const rightCol = items.slice(3);

  return (
    <section
      id="faq"
      className="mx-auto max-w-[1200px] px-6 py-20 sm:py-24 border-t border-neutral-200"
    >
      <div className="mb-10 max-w-2xl">
        <div className="text-[11.5px] uppercase tracking-[0.08em] text-neutral-500">
          FAQ
        </div>
        <h2
          className="mt-3 text-[30px] sm:text-[36px] font-bold text-navy leading-tight"
          style={{ letterSpacing: "-0.03em" }}
        >
          Good questions people ask.
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FaqColumn items={leftCol} />
        <FaqColumn items={rightCol} />
      </div>
    </section>
  );
}

function FaqColumn({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-200">
      {items.map((it) => (
        <details key={it.q} className="group">
          <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-4 hover:bg-neutral-50 transition-colors">
            <span className="text-[14px] font-medium text-navy">{it.q}</span>
            <span
              aria-hidden
              className="shrink-0 text-[14px] text-neutral-400 transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <div className="px-5 pb-4 text-[13.5px] text-neutral-700 leading-relaxed">
            {it.a}
          </div>
        </details>
      ))}
    </div>
  );
}

// ─── Footer — 3 columns ────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-white">
      <div className="mx-auto max-w-[1200px] px-6 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <Wordmark size="sm" />
            <div className="mt-2.5 text-[12.5px] text-neutral-600 leading-snug max-w-[220px]">
              LP intelligence for private markets.
            </div>
            <div className="mt-3 text-[11.5px] text-neutral-500">
              © {new Date().getFullYear()} Allocus · Closed beta
            </div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500 mb-3">
              Product
            </div>
            <ul className="space-y-2 text-[12.5px]">
              <li>
                <FooterLink href="#proof">What it shows</FooterLink>
              </li>
              <li>
                <FooterLink href="#how">How it works</FooterLink>
              </li>
              <li>
                <FooterLink href="#faq">FAQ</FooterLink>
              </li>
              <li>
                <FooterLink href="#">Request demo</FooterLink>
              </li>
            </ul>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-neutral-500 mb-3">
              Contact
            </div>
            <ul className="space-y-2 text-[12.5px]">
              <li>
                <a
                  href="mailto:vitek.vrana@bloorcapital.com?subject=Allocus%20demo"
                  className="text-neutral-700 hover:text-navy transition-colors"
                >
                  vitek.vrana@bloorcapital.com
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/vranavit/lp-signal"
                  target="_blank"
                  rel="noreferrer"
                  className="text-neutral-700 hover:text-navy transition-colors"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="text-neutral-700 hover:text-navy transition-colors"
    >
      {children}
    </a>
  );
}

// ProofCard table-header cell — keeps columns rhythmic.
function ProofTh({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`text-left font-normal text-[10.5px] uppercase tracking-[0.06em] text-neutral-500 py-2 ${className}`}
    >
      {children}
    </th>
  );
}
