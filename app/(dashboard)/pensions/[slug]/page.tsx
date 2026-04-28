import { Fragment } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUSD, formatDate } from "@/lib/utils";
import { AuditTrailTrigger } from "@/components/audit-trail-modal";
import { ConfidenceBadge } from "@/components/accuracy/confidence-badge";
import { StaleIndicator } from "@/components/accuracy/stale-indicator";
import { TimeAgo } from "@/components/accuracy/time-ago";
import { Extrapolated } from "@/components/accuracy/extrapolated";
import { PensionHeroUnfunded } from "@/components/accuracy/pension-hero-unfunded";
import { availabilityFor, isEmpty } from "@/lib/plans/data-availability";
import {
  eventDateTooltip,
  resolveEventDate,
} from "@/lib/signals/event-date";
import {
  privateMarketsUnfundedSummary,
  privateMarketsUnfundedUsd,
} from "@/lib/relevance/unfunded";
import { resolvePlanAum } from "@/lib/relevance/plan-aum";
import { classifyVsRange, bandLabel } from "@/lib/relevance/range-classify";

export const dynamic = "force-dynamic";

// Per-asset-class summed view, one row per (plan, asset_class). Read from
// pension_allocations_rollup. Sub-sleeves are summed; actual_pct/actual_usd
// are NULL when any contributing sub-sleeve is target-only.
// target_min_pct / target_max_pct surface only when sub_class_count = 1.
type AllocationRollupRow = {
  as_of_date: string;
  asset_class: string;
  target_pct: number;
  target_min_pct: number | null;
  target_max_pct: number | null;
  actual_pct: number | null;
  actual_usd: number | null;
  total_plan_aum_usd: number | null;
  preliminary: boolean;
  sub_class_count: number;
};

// Per-row view, one row per (plan, as_of_date, asset_class, sub_class).
// Read from pension_allocations_latest. Used for sub-sleeve children +
// audit-trail data + per-row policy range / confidence.
type AllocationLeafRow = {
  id: string;
  as_of_date: string;
  asset_class: string;
  sub_class: string | null;
  target_pct: number;
  target_min_pct: number | null;
  target_max_pct: number | null;
  actual_pct: number | null;
  actual_usd: number | null;
  total_plan_aum_usd: number | null;
  source_document_id: string | null;
  source_page: number | null;
  source_quote: string | null;
  confidence: number;
  preliminary: boolean;
};

type AllocationGroup = {
  rollup: AllocationRollupRow;
  // For sub_class_count > 1: every sub-sleeve under this asset_class.
  // For sub_class_count === 1: the single underlying row, used to source
  // policy range / confidence / audit-trail data the rollup can't expose.
  leaves: AllocationLeafRow[];
};

type ConsultantRow = {
  id: string;
  mandate_type: string;
  fee_usd: string | number | null;
  fee_year: number | null;
  source_type: string;
  source_url: string | null;
  source_excerpt: string | null;
  source_document_id: string | null;
  consultant: { canonical_name: string; website: string | null } | null;
  document: { source_url: string | null; meeting_date: string | null } | null;
};

export default async function PensionProfilePage({
  params,
}: {
  params: { slug: string };
}) {
  const supabase = createSupabaseServerClient();

  // Slug = scrape_config.key. Cheap to query across all plans and filter in JS
  // since the total row count is tiny (~12 plans).
  const { data: plans } = await supabase
    .from("plans")
    .select(
      "id, name, country, aum_usd, tier, scrape_config, scrape_url, last_scraped_at",
    );
  const plan = plans?.find(
    (p) =>
      typeof p.scrape_config === "object" &&
      p.scrape_config &&
      (p.scrape_config as Record<string, unknown>).key === params.slug,
  );
  if (!plan) notFound();

  // Two-view read:
  //   - rollup view: one row per asset_class (sub-sleeves summed). Used for
  //     parent rows + hero math + headline counts.
  //   - latest view: every sub-sleeve from the most recent CAFR per
  //     (plan, asset_class). Used for child rows under a sub-sleeve parent
  //     AND as the single-row data source when sub_class_count === 1
  //     (policy range / confidence / audit-trail data).
  const [{ data: rollupData }, { data: leafData }] = await Promise.all([
    supabase
      .from("pension_allocations_rollup")
      .select(
        "as_of_date, asset_class, target_pct, target_min_pct, target_max_pct, actual_pct, actual_usd, total_plan_aum_usd, preliminary, sub_class_count",
      )
      .eq("plan_id", plan.id)
      .order("asset_class", { ascending: true }),
    supabase
      .from("pension_allocations_latest")
      .select(
        "id, as_of_date, asset_class, sub_class, target_pct, target_min_pct, target_max_pct, actual_pct, actual_usd, total_plan_aum_usd, source_document_id, source_page, source_quote, confidence, preliminary",
      )
      .eq("plan_id", plan.id)
      .order("asset_class", { ascending: true })
      .order("sub_class", { ascending: true, nullsFirst: true }),
  ]);

  const rollupRows = (rollupData ?? []) as AllocationRollupRow[];
  const leafRows = (leafData ?? []) as AllocationLeafRow[];

  // Group leaves under their parent asset_class for the table renderer.
  const leavesByClass = new Map<string, AllocationLeafRow[]>();
  for (const l of leafRows) {
    if (!leavesByClass.has(l.asset_class)) leavesByClass.set(l.asset_class, []);
    leavesByClass.get(l.asset_class)!.push(l);
  }
  const groups: AllocationGroup[] = rollupRows.map((rollup) => ({
    rollup,
    leaves: leavesByClass.get(rollup.asset_class) ?? [],
  }));

  const latestAsOf = rollupRows[0]?.as_of_date ?? null;
  const allocAum =
    rollupRows.find((r) => r.total_plan_aum_usd)?.total_plan_aum_usd ?? null;
  // Resolved AUM: prefer the latest CAFR snapshot when within 0.5x-2x of the
  // editorial plan_aum, fall back to plan_aum on anomaly (defends against
  // wrong-document ingestions like the CalPERS / CERBT incident).
  const resolvedAum = resolvePlanAum(
    plan.aum_usd,
    allocAum,
    latestAsOf,
    plan.name,
  );
  const totalAum = resolvedAum.value;

  // Unfunded budget = (target − actual) / 100 × AUM, capped at zero, summed
  // across private-markets asset classes. This is the cold-email headline.
  // Computed off the rollup view so sub-sleeves don't double-count.
  const headlineUnfunded = privateMarketsUnfundedUsd(rollupRows);
  const unfundedSummary = privateMarketsUnfundedSummary(rollupRows);
  // Per-class list for the hero chip strip + math modal. Non-zero gaps only;
  // target-only rows (actuals missing) are surfaced via the summary's
  // targetOnlyCount + the math modal, NOT as fake chips.
  const perClassUnfunded: Array<{
    asset_class: string;
    unfunded_usd: number;
    hasActuals?: boolean;
  }> = unfundedSummary.perClass
    .filter((r) => r.hasActuals && r.unfunded_usd > 0)
    .sort((a, b) => b.unfunded_usd - a.unfunded_usd);
  const targetOnlyAssetClasses = unfundedSummary.perClass
    .filter((r) => !r.hasActuals)
    .map((r) => r.asset_class);

  // Detected policy changes for this plan (most recent first).
  const { data: policyChanges } = await supabase
    .from("allocation_policy_changes")
    .select(
      "id, asset_class, previous_target_pct, new_target_pct, change_pp, change_direction, as_of_date_previous, as_of_date_new, implied_usd_delta",
    )
    .eq("plan_id", plan.id)
    .order("as_of_date_new", { ascending: false })
    .order("asset_class", { ascending: true });

  // Investment consultants engaged by this plan, with fee + source-document
  // data. plan_consultants.source_url is currently always NULL — the link
  // resolves via documents.source_url joined on source_document_id.
  const { data: consultantData } = await supabase
    .from("plan_consultants")
    .select(
      "id, mandate_type, fee_usd, fee_year, source_type, source_url, source_excerpt, source_document_id, consultant:consultants(canonical_name, website), document:documents(source_url, meeting_date)",
    )
    .eq("plan_id", plan.id);
  const consultantRows = (consultantData ?? []) as unknown as ConsultantRow[];

  // Last 6 months of transaction signals from this plan (T1/T2/T3). Shown
  // as a "Recent signals" section below the allocation table — transforms
  // the page from a static allocation snapshot into a pension dossier.
  const sixMonthsAgo = new Date(
    Date.now() - 180 * 86_400_000,
  ).toISOString();
  const { data: signalsRecent } = await supabase
    .from("signals")
    .select(
      "id, document_id, signal_type, confidence, priority_score, asset_class, summary, fields, source_page, source_quote, commitment_amount_usd, preliminary, created_at, document:documents(id, source_url, meeting_date)",
    )
    .eq("plan_id", plan.id)
    .eq("seed_data", false)
    .not("validated_at", "is", null)
    .gte("created_at", sixMonthsAgo)
    .order("created_at", { ascending: false })
    .limit(25);

  const { count: signalsCount } = await supabase
    .from("signals")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", plan.id)
    .not("validated_at", "is", null);

  type RecentSignal = {
    id: string;
    document_id: string | null;
    signal_type: 1 | 2 | 3;
    confidence: number;
    priority_score: number;
    asset_class: string | null;
    summary: string;
    fields: Record<string, unknown>;
    source_page: number | null;
    source_quote: string | null;
    commitment_amount_usd: number | null;
    preliminary: boolean;
    created_at: string;
    document: { id: string; source_url: string; meeting_date: string | null } | null;
  };
  const recentSignals = (signalsRecent ?? []) as unknown as RecentSignal[];

  const planWebsite =
    typeof plan.scrape_config === "object" && plan.scrape_config
      ? ((plan.scrape_config as Record<string, unknown>).website as
          | string
          | undefined) ?? null
      : null;

  // Data-availability check. If a plan has no signals, no allocations, and
  // no processed documents, render a calm "in progress" state instead of
  // empty tables that read like a broken page.
  const { count: docsCount } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", plan.id)
    .eq("processing_status", "complete");
  const dataEmpty = isEmpty({
    signals: signalsCount ?? 0,
    allocations: rollupRows.length,
    documents: docsCount ?? 0,
  });

  if (dataEmpty) {
    const avail = availabilityFor(plan.name);
    return (
      <div className="space-y-4 max-w-5xl">
        <Link
          href="/plans"
          className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Plans
        </Link>

        <section className="card-surface px-5 py-5">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-ink-faint uppercase tracking-wide">
                {plan.country} · Tier {plan.tier ?? "—"}
              </div>
              <h1 className="mt-1 text-[22px] font-semibold tracking-tightish text-ink leading-tight">
                {plan.name}
              </h1>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
                <span>
                  AUM{" "}
                  <span className="num tabular-nums text-ink">
                    {formatUSD(plan.aum_usd)}
                  </span>{" "}
                  <span className="text-ink-faint text-[10.5px]">(editorial)</span>
                </span>
                {planWebsite ? (
                  <a
                    href={planWebsite}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-hi hover:underline"
                  >
                    Plan website ↗
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="card-surface py-12 px-6 flex flex-col items-center justify-center gap-4 text-center">
          <div className="h-10 w-10 rounded-full bg-bg-panel border border-line flex items-center justify-center">
            <span
              aria-hidden
              className={
                "inline-block h-2 w-2 rounded-full " +
                (avail.status === "blocked"
                  ? "bg-amber-500"
                  : "bg-neutral-400")
              }
            />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink">
              {avail.status === "blocked"
                ? "Blocked at source"
                : "Data ingestion in progress"}
            </div>
            <div className="mt-1.5 text-[12.5px] text-ink-muted max-w-md leading-relaxed mx-auto">
              {avail.reason ??
                "This plan is in the Allocus pipeline but hasn't been ingested yet. Check back soon."}
            </div>
          </div>
          <Link
            href="/plans"
            className="text-[12px] text-accent-hi hover:underline"
          >
            ← Back to plans
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <Link
        href="/plans"
        className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        Plans
      </Link>

      {/* Hero: plan name + prominent unfunded budget headline */}
      <section className="card-surface px-5 py-5">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-ink-faint uppercase tracking-wide">
              {plan.country} · Tier {plan.tier ?? "—"}
            </div>
            <h1 className="mt-1 text-[22px] font-semibold tracking-tightish text-ink leading-tight">
              {plan.name}
            </h1>
            <MetadataRow
              plan={plan}
              latestAsOf={latestAsOf}
              website={planWebsite}
              resolvedAum={resolvedAum}
            />
          </div>
          {headlineUnfunded > 0 ? (
            <div className="text-right shrink-0">
              <div className="text-[10.5px] text-ink-faint uppercase tracking-wide">
                Unfunded private-markets budget
              </div>
              <div className="mt-1">
                <PensionHeroUnfunded
                  planName={plan.name}
                  total={headlineUnfunded}
                  perClass={perClassUnfunded}
                  asOfDate={latestAsOf}
                  aumUsd={resolvedAum.value}
                  withActualsCount={unfundedSummary.withActualsCount}
                  targetOnlyCount={unfundedSummary.targetOnlyCount}
                />
              </div>
              {unfundedSummary.targetOnlyCount > 0 ? (
                <div
                  className="mt-2 inline-flex items-center h-5 px-1.5 rounded-sm border border-amber-200 bg-amber-50 text-amber-800 text-[10.5px] font-medium cursor-help"
                  title={`Target-only asset classes (no current actual in the latest CAFR, conservatively counted as \$0 gap): ${targetOnlyAssetClasses.join(", ")}. Actual allocation data unavailable from most recent CAFR.`}
                >
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 mr-1"
                  />
                  Target-only for {unfundedSummary.targetOnlyCount} asset class
                  {unfundedSummary.targetOnlyCount === 1 ? "" : "es"}
                </div>
              ) : null}
              <div
                className="text-[11px] text-ink-faint mt-1 flex items-center justify-end gap-1 cursor-help"
                title="Pensions typically publish CAFRs 6-12 months after fiscal year-end. This is the most recent publicly available."
              >
                <span>
                  Most recent CAFR: FY{" "}
                  <span className="num tabular-nums">
                    {latestAsOf ? latestAsOf.slice(0, 4) : "—"}
                  </span>
                  {latestAsOf ? (
                    <>
                      {" "}
                      · snapshot{" "}
                      <span className="num tabular-nums">
                        {formatDate(latestAsOf)}
                      </span>
                    </>
                  ) : null}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Per-class unfunded chips */}
        {perClassUnfunded.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {perClassUnfunded.map((b) => (
              <div
                key={b.asset_class}
                className="border border-line rounded-sm px-2.5 py-1.5 min-w-[88px]"
              >
                <div className="text-[10.5px] text-ink-faint uppercase tracking-wide">
                  {b.asset_class}
                </div>
                <div className="num tabular-nums text-[13px] text-ink font-medium leading-tight">
                  {formatUSD(b.unfunded_usd)}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* Stat strip */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Plan AUM"
          value={formatUSD(resolvedAum.value)}
          sublabel={
            resolvedAum.source === "allocation" && resolvedAum.asOfDate
              ? `as of ${formatDate(resolvedAum.asOfDate)}`
              : resolvedAum.source === "plan_table"
              ? "editorial estimate"
              : undefined
          }
        />
        <StatCard
          label="Transaction signals"
          value={String(signalsCount ?? 0)}
          sublabel="all time, accepted + preliminary"
        />
        <StatCard
          label="Asset classes"
          value={String(rollupRows.length)}
          sublabel={
            latestAsOf
              ? `${rollupRows.length === 0 ? "none" : "in latest policy"}`
              : "no CAFR ingested"
          }
        />
      </div>

      {/* Asset Allocation */}
      <section className="card-surface">
        <div className="px-4 py-3 border-b border-line flex items-end justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium text-ink">
              Asset Allocation
            </div>
            <div className="mt-0.5 text-[12px] text-ink-muted">
              {latestAsOf ? (
                <>
                  Target vs actual as of{" "}
                  <span className="num tabular-nums">
                    {formatDate(latestAsOf)}
                  </span>
                  . When a policy range is published, an actual within the
                  band shows no gap; deployment opportunity is computed
                  against the band minimum, not the midpoint.
                </>
              ) : (
                "No CAFR allocations ingested yet."
              )}
            </div>
          </div>
          {totalAum ? (
            <div className="text-right">
              <div className="text-[11px] text-ink-faint">Plan AUM</div>
              <div className="num tabular-nums text-[13px] text-ink font-medium">
                {formatUSD(totalAum)}
              </div>
            </div>
          ) : null}
        </div>

        {groups.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-ink-muted">
            Ingest this plan&apos;s CAFR to populate allocation data.
          </div>
        ) : (
          <AllocationTable groups={groups} totalAum={totalAum} />
        )}
      </section>

      {/* Recent transaction signals from this plan (last 6 months). */}
      {recentSignals.length > 0 ? (
        <section className="card-surface">
          <div className="px-4 py-3 border-b border-line flex items-end justify-between gap-4">
            <div>
              <div className="text-[13px] font-medium text-ink">
                Recent signals
              </div>
              <div className="mt-0.5 text-[12px] text-ink-muted">
                Commitments, target changes, and pacing moves extracted from
                board minutes in the last 6 months.
              </div>
            </div>
            <Link
              href={`/signals?plan=${plan.id}`}
              className="text-[12px] text-accent-hi hover:underline"
            >
              All signals →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink-faint">
                  <Th className="w-[110px]">Date</Th>
                  <Th className="w-[56px]">Type</Th>
                  <Th className="w-[108px]">Accuracy</Th>
                  <Th className="w-[60px]">Asset</Th>
                  <Th>Summary</Th>
                  <Th className="text-right w-[110px]">Amount</Th>
                  <Th className="w-[32px]"> </Th>
                </tr>
              </thead>
              <tbody>
                {recentSignals.map((s) => {
                  const tag =
                    s.signal_type === 1
                      ? "T1"
                      : s.signal_type === 2
                      ? "T2"
                      : "T3";
                  return (
                    <tr
                      key={s.id}
                      className="h-10 border-b border-line last:border-b-0 odd:bg-black/[0.015] dark:odd:bg-white/[0.02] hover:bg-bg-hover transition-colors duration-150"
                    >
                      <td className="px-3 align-middle">
                        {(() => {
                          const ev = resolveEventDate(s);
                          const isFallback = ev.source === "ingestion";
                          return (
                            <span
                              className="inline-flex items-center gap-1"
                              title={eventDateTooltip(ev)}
                            >
                              <span
                                className={
                                  "num tabular-nums text-[11.5px] cursor-help " +
                                  (isFallback
                                    ? "text-amber-700"
                                    : "text-ink-muted")
                                }
                              >
                                {formatDate(ev.date)}
                              </span>
                              <StaleIndicator
                                date={ev.date}
                                cutoffDays={30}
                                kind="signal"
                                signalType={s.signal_type}
                              />
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 align-middle text-[11px] text-ink-muted">
                        {tag}
                      </td>
                      <td className="px-3 align-middle">
                        <ConfidenceBadge
                          confidence={s.confidence}
                          priority={s.priority_score}
                          preliminary={s.preliminary}
                          compact
                        />
                      </td>
                      <td className="px-3 align-middle text-[12px] text-ink-muted">
                        {s.asset_class ?? "—"}
                      </td>
                      <td className="px-3 align-middle">
                        <Link
                          href={`/signals/${s.id}`}
                          className="text-[12.5px] text-ink hover:text-accent-hi hover:underline line-clamp-1 max-w-[480px] inline-block"
                        >
                          {s.summary}
                        </Link>
                        {s.preliminary ? (
                          <span className="ml-2 inline-flex items-center gap-1 text-[10.5px] text-ink-faint">
                            <span className="h-1.5 w-1.5 rounded-full bg-ink-dim inline-block" />
                            preliminary
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 align-middle text-right num tabular-nums text-[12.5px] text-ink">
                        {s.commitment_amount_usd
                          ? formatUSD(s.commitment_amount_usd)
                          : "—"}
                      </td>
                      <td className="px-2 align-middle text-right">
                        <AuditTrailTrigger
                          documentId={s.document_id}
                          sourcePage={s.source_page}
                          sourceQuote={s.source_quote}
                          eventDate={resolveEventDate(s)}
                          ingestedAt={s.created_at}
                          inline
                          label=""
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Policy changes — only render section if there's data to show. */}
      {policyChanges && policyChanges.length > 0 ? (
        <section className="card-surface">
          <div className="px-4 py-3 border-b border-line">
            <div className="text-[13px] font-medium text-ink">
              Policy changes
            </div>
            <div className="mt-0.5 text-[12px] text-ink-muted">
              Target allocation moves between consecutive CAFR snapshots.
              Increases (green) point to net new deployment budget; decreases
              (red) signal program wind-downs or rebalances.
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink-faint">
                  <Th>Asset Class</Th>
                  <Th className="text-right w-[120px]">Previous</Th>
                  <Th className="text-right w-[120px]">New</Th>
                  <Th className="text-right w-[100px]">Δ (pp)</Th>
                  <Th className="text-right w-[140px]">Implied $</Th>
                  <Th className="text-right w-[180px]">Period</Th>
                </tr>
              </thead>
              <tbody>
                {policyChanges.map((c) => {
                  const isInc = c.change_direction === "increase";
                  const isDec = c.change_direction === "decrease";
                  return (
                    <tr
                      key={c.id}
                      className="h-11 border-b border-line last:border-b-0 odd:bg-black/[0.015] dark:odd:bg-white/[0.02]"
                    >
                      <td className="px-4 py-0 align-middle text-ink">
                        {c.asset_class}
                      </td>
                      <td className="px-4 py-0 align-middle text-right num tabular-nums text-ink-muted">
                        {fmtPct(Number(c.previous_target_pct))}
                      </td>
                      <td className="px-4 py-0 align-middle text-right num tabular-nums text-ink">
                        {fmtPct(Number(c.new_target_pct))}
                      </td>
                      <td className="px-4 py-0 align-middle text-right">
                        <span
                          className={
                            "num tabular-nums font-medium " +
                            (isInc
                              ? "text-green-700 dark:text-green-400"
                              : isDec
                              ? "text-red-700 dark:text-red-400"
                              : "text-ink-muted")
                          }
                        >
                          {Number(c.change_pp) > 0 ? "+" : ""}
                          {fmtPct(Number(c.change_pp))}
                        </span>
                      </td>
                      <td className="px-4 py-0 align-middle text-right">
                        {c.implied_usd_delta != null ? (
                          <span
                            className={
                              "num tabular-nums " +
                              (Number(c.implied_usd_delta) > 0
                                ? "text-green-700 dark:text-green-400"
                                : Number(c.implied_usd_delta) < 0
                                ? "text-red-700 dark:text-red-400"
                                : "text-ink-muted")
                            }
                          >
                            {Number(c.implied_usd_delta) > 0 ? "+" : "−"}
                            {formatUSD(Math.abs(Number(c.implied_usd_delta)))}
                          </span>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="px-4 py-0 align-middle text-right num tabular-nums text-[11.5px] text-ink-muted">
                        {formatDate(c.as_of_date_previous)} →{" "}
                        {formatDate(c.as_of_date_new)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Investment consultants engaged by this plan. Always renders --
          empty state asks for tips for the 8 plans we don't yet cover. */}
      <ConsultantsSection rows={consultantRows} />
    </div>
  );
}

function AllocationTable({
  groups,
  totalAum,
}: {
  groups: AllocationGroup[];
  totalAum: number | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-ink-faint">
            <Th>Asset Class</Th>
            <Th className="w-[108px]">Accuracy</Th>
            <Th className="text-right w-[120px]">Target %</Th>
            <Th className="text-right w-[140px]">Policy Range</Th>
            <Th className="text-right w-[100px]">Actual %</Th>
            <Th className="text-right w-[100px]">Gap (pp)</Th>
            <Th className="text-right w-[140px]">$ Gap</Th>
            <Th className="w-[32px]"> </Th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const hasSubSleeves = g.rollup.sub_class_count > 1;
            const single = !hasSubSleeves ? g.leaves[0] ?? null : null;
            return (
              <Fragment key={g.rollup.asset_class}>
                <ParentRow
                  rollup={g.rollup}
                  single={single}
                  totalAum={totalAum}
                  hasSubSleeves={hasSubSleeves}
                />
                {hasSubSleeves
                  ? g.leaves.map((leaf, idx) => (
                      <ChildRow
                        key={leaf.id}
                        leaf={leaf}
                        totalAum={totalAum}
                        isLast={idx === g.leaves.length - 1}
                      />
                    ))
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Parent row. Always visible. Reads target/actual/AUM from the rollup view
// so target-only NULL semantics are preserved (rollup's bool_and guard
// already returns NULL whenever ANY contributing sub-sleeve is target-only).
// Range-aware: when target_min_pct + target_max_pct + actual_pct are all
// present, render a range classification (below / within / above) instead
// of a naive (target - actual) gap. Within-range allocations show no $ gap
// because policy explicitly endorses anywhere in the band.
function ParentRow({
  rollup,
  single,
  totalAum,
  hasSubSleeves,
}: {
  rollup: AllocationRollupRow;
  single: AllocationLeafRow | null;
  totalAum: number | null;
  hasSubSleeves: boolean;
}) {
  const minPct = rollup.target_min_pct;
  const maxPct = rollup.target_max_pct;
  return (
    <AllocationRow
      kind="parent"
      label={rollup.asset_class}
      accuracy={
        hasSubSleeves ? (
          <span
            className="text-[10.5px] text-ink-faint"
            title={`Calculated from ${rollup.sub_class_count} policy sub-sleeves below.`}
          >
            Σ {rollup.sub_class_count} sleeves
          </span>
        ) : single ? (
          <ConfidenceBadge
            confidence={single.confidence}
            priority={100}
            preliminary={single.preliminary}
          />
        ) : null
      }
      targetPct={rollup.target_pct}
      minPct={minPct}
      maxPct={maxPct}
      actualPct={rollup.actual_pct}
      totalAum={totalAum}
      sourceQuote={single?.source_quote ?? null}
      audit={
        !hasSubSleeves && single ? (
          <AuditTrailTrigger
            documentId={single.source_document_id}
            sourcePage={single.source_page}
            sourceQuote={single.source_quote}
            inline
            label=""
          />
        ) : null
      }
    />
  );
}

// Indented sub-sleeve row. Only rendered when the parent has > 1 sleeves.
// Each leaf carries its own confidence, range, and source quote.
function ChildRow({
  leaf,
  totalAum,
  isLast,
}: {
  leaf: AllocationLeafRow;
  totalAum: number | null;
  isLast: boolean;
}) {
  const connector = isLast ? "└" : "├";
  return (
    <AllocationRow
      kind="child"
      label={
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted">
          <span aria-hidden className="text-ink-faint pl-3 font-mono">
            {connector}
          </span>
          {leaf.sub_class ?? leaf.asset_class}
        </span>
      }
      accuracy={
        <ConfidenceBadge
          confidence={leaf.confidence}
          priority={100}
          preliminary={leaf.preliminary}
        />
      }
      targetPct={leaf.target_pct}
      minPct={leaf.target_min_pct}
      maxPct={leaf.target_max_pct}
      actualPct={leaf.actual_pct}
      totalAum={totalAum}
      sourceQuote={leaf.source_quote}
      audit={
        <AuditTrailTrigger
          documentId={leaf.source_document_id}
          sourcePage={leaf.source_page}
          sourceQuote={leaf.source_quote}
          inline
          label=""
        />
      }
    />
  );
}

// Shared row renderer. Picks range-aware classification when a policy band
// is present + actual is populated; falls back to (target - actual) when
// only a point target exists. Within-range allocations render the band
// position instead of a misleading "+/-pp" gap, and the $ gap is omitted
// because the band itself endorses the position.
function AllocationRow({
  kind,
  label,
  accuracy,
  targetPct,
  minPct,
  maxPct,
  actualPct,
  totalAum,
  sourceQuote,
  audit,
}: {
  kind: "parent" | "child";
  label: React.ReactNode;
  accuracy: React.ReactNode;
  targetPct: number;
  minPct: number | null;
  maxPct: number | null;
  actualPct: number | null;
  totalAum: number | null;
  sourceQuote: string | null;
  audit: React.ReactNode;
}) {
  const hasRange = minPct != null && maxPct != null;
  const classification =
    actualPct != null && hasRange
      ? classifyVsRange(actualPct, minPct!, maxPct!)
      : null;
  const pointGapPct =
    actualPct != null && !hasRange ? targetPct - actualPct : null;

  // $ gap: range-aware. Below band -> deployment opportunity at min.
  // Above band -> rebalance pressure at max (rendered red but still a $
  // figure for context). Within band -> no $ gap because policy endorses.
  // No-range fallback uses the existing point-target math.
  let gapUsd: number | null = null;
  if (classification && totalAum) {
    if (classification.kind === "below") {
      gapUsd = Math.round((classification.gapPp / 100) * totalAum);
    } else if (classification.kind === "above") {
      gapUsd = -Math.round((classification.gapPp / 100) * totalAum);
    }
  } else if (pointGapPct != null && totalAum) {
    gapUsd = Math.round((pointGapPct / 100) * totalAum);
  }

  const rowClass =
    kind === "parent"
      ? "h-11 border-b border-line last:border-b-0 odd:bg-black/[0.015] dark:odd:bg-white/[0.02]"
      : "h-10 border-b border-line last:border-b-0 odd:bg-black/[0.01] dark:odd:bg-white/[0.015]";

  const targetCls =
    kind === "parent"
      ? "px-4 py-0 align-middle text-right num tabular-nums text-ink"
      : "px-4 py-0 align-middle text-right num tabular-nums text-ink-muted";
  const rangeCls =
    kind === "parent"
      ? "px-4 py-0 align-middle text-right num tabular-nums text-ink-muted"
      : "px-4 py-0 align-middle text-right num tabular-nums text-ink-faint";
  const actualCls = rangeCls;
  const usdMutedCls =
    kind === "parent" ? "text-ink-muted" : "text-ink-faint";

  return (
    <tr className={rowClass} title={sourceQuote ?? undefined}>
      <td className="px-4 py-0 align-middle text-ink">
        {typeof label === "string" ? <span>{label}</span> : label}
      </td>
      <td className="px-4 py-0 align-middle">{accuracy}</td>
      <td className={targetCls}>{fmtPct(targetPct)}</td>
      <td className={rangeCls}>
        {hasRange ? `${fmtPct(minPct!)} – ${fmtPct(maxPct!)}` : "—"}
      </td>
      <td className={actualCls}>
        {actualPct != null ? fmtPct(actualPct) : "—"}
      </td>
      <td className="px-4 py-0 align-middle text-right">
        {classification ? (
          <RangeBadge classification={classification} />
        ) : pointGapPct != null ? (
          <Extrapolated method="target% − actual%">
            <span
              className={
                "num tabular-nums " +
                (kind === "parent" ? "font-medium " : "") +
                (pointGapPct > 0.5
                  ? "text-green-700 dark:text-green-400"
                  : pointGapPct < -0.5
                  ? "text-red-700 dark:text-red-400"
                  : usdMutedCls)
              }
            >
              {pointGapPct > 0 ? "+" : ""}
              {fmtPct(pointGapPct)}
            </span>
          </Extrapolated>
        ) : (
          <span className="text-ink-faint">—</span>
        )}
      </td>
      <td className="px-4 py-0 align-middle text-right">
        {gapUsd == null ? (
          <span className="text-ink-faint">—</span>
        ) : classification?.kind === "within" ? (
          // Should never hit -- gapUsd is null in within. Defensive.
          <span className="text-ink-faint">—</span>
        ) : (
          <Extrapolated
            method={
              classification
                ? classification.kind === "below"
                  ? "(min − actual) ÷ 100 × plan AUM"
                  : "(actual − max) ÷ 100 × plan AUM"
                : "gap(pp) ÷ 100 × plan AUM"
            }
          >
            <span
              className={
                "num tabular-nums " +
                (gapUsd > 0
                  ? "text-green-700 dark:text-green-400"
                  : gapUsd < 0
                  ? "text-red-700 dark:text-red-400"
                  : usdMutedCls)
              }
            >
              {gapUsd > 0 ? "+" : gapUsd < 0 ? "−" : ""}
              {formatUSD(Math.abs(gapUsd))}
            </span>
          </Extrapolated>
        )}
      </td>
      <td className="px-2 py-0 align-middle text-right">{audit}</td>
    </tr>
  );
}

function RangeBadge({
  classification,
}: {
  classification: ReturnType<typeof classifyVsRange>;
}) {
  if (classification.kind === "below") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 dark:text-red-400"
        title={`Actual is ${classification.gapPp.toFixed(2)}pp below the policy minimum.`}
      >
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-red-500"
        />
        below band
        <span className="num tabular-nums text-ink-muted">
          −{fmtPct(classification.gapPp)}
        </span>
      </span>
    );
  }
  if (classification.kind === "above") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400"
        title={`Actual is ${classification.gapPp.toFixed(2)}pp above the policy maximum.`}
      >
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
        />
        above band
        <span className="num tabular-nums text-ink-muted">
          +{fmtPct(classification.gapPp)}
        </span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
      title={`Actual sits at ${classification.positionPct.toFixed(0)}% of the policy band.`}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
      />
      in band
      <span className="text-ink-muted">· {bandLabel(classification.band)}</span>
    </span>
  );
}

function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="card-surface px-4 py-3">
      <div className="text-[10.5px] text-ink-faint uppercase tracking-wide">
        {label}
      </div>
      <div className="num tabular-nums text-[18px] font-semibold text-ink leading-tight mt-0.5">
        {value}
      </div>
      {sublabel ? (
        <div className="text-[11px] text-ink-faint mt-0.5">{sublabel}</div>
      ) : null}
    </div>
  );
}

function MetadataRow({
  plan,
  latestAsOf,
  website,
  resolvedAum,
}: {
  plan: {
    scrape_url: string | null;
    last_scraped_at: string | null;
    aum_usd: number | null;
  };
  latestAsOf: string | null;
  website: string | null;
  resolvedAum: ReturnType<typeof resolvePlanAum>;
}) {
  const homeUrl = website ?? plan.scrape_url ?? null;
  const aumLabel =
    resolvedAum.source === "allocation"
      ? "AUM (CAFR)"
      : resolvedAum.source === "plan_table"
      ? "AUM (editorial)"
      : "AUM";
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
      <span>
        {aumLabel}{" "}
        <span className="num tabular-nums text-ink">
          {formatUSD(resolvedAum.value ?? plan.aum_usd)}
        </span>
        {resolvedAum.source === "allocation" && resolvedAum.asOfDate ? (
          <span className="text-ink-faint">
            {" "}· as of{" "}
            <span className="num tabular-nums">
              {formatDate(resolvedAum.asOfDate)}
            </span>
          </span>
        ) : null}
      </span>
      {latestAsOf && resolvedAum.source !== "allocation" ? (
        <span>
          Latest CAFR{" "}
          <span className="num tabular-nums text-ink">{formatDate(latestAsOf)}</span>
        </span>
      ) : null}
      {plan.last_scraped_at ? (
        <span>
          Last scrape{" "}
          <span className="num tabular-nums">{formatDate(plan.last_scraped_at)}</span>
        </span>
      ) : null}
      {homeUrl ? (
        <a
          href={homeUrl}
          target="_blank"
          rel="noreferrer"
          className="text-accent-hi hover:underline"
        >
          Plan website ↗
        </a>
      ) : null}
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={
        "text-left font-normal text-[12px] text-ink-faint px-4 h-9 bg-bg-subtle " +
        className
      }
    >
      {children}
    </th>
  );
}

// Display order for mandate groups. Anything not in this list falls to the
// bottom in alphabetical order (e.g. future "infrastructure" / "credit").
const CONSULTANT_MANDATE_ORDER = [
  "general",
  "private_equity",
  "real_estate",
  "hedge_funds",
] as const;
const CONSULTANT_MANDATE_LABEL: Record<string, string> = {
  general: "General",
  private_equity: "Private Equity",
  real_estate: "Real Estate",
  hedge_funds: "Hedge Funds",
};

function ConsultantsSection({ rows }: { rows: ConsultantRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="card-surface">
        <div className="px-4 py-3 border-b border-line">
          <div className="text-[13px] font-medium text-ink">
            Investment Consultants
          </div>
        </div>
        <div className="px-6 py-10 flex flex-col items-center justify-center gap-2 text-center">
          <div className="h-8 w-8 rounded-full bg-bg-panel border border-line flex items-center justify-center">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full bg-neutral-400"
            />
          </div>
          <div className="text-[12.5px] text-ink-muted">
            Consultant data not yet available for this plan.
          </div>
          <div className="text-[11.5px] text-ink-faint">
            Have a tip?{" "}
            <a
              href="mailto:vitek@bloorcapital.com"
              className="text-accent-hi hover:underline"
            >
              vitek@bloorcapital.com
            </a>
          </div>
        </div>
      </section>
    );
  }

  // Subtitle: when every row carries the same source_type, surface that fact
  // once at the section level rather than as redundant per-row badges. When
  // mixed, fall back to a count and let per-row badges (added in a future
  // phase) carry the source signal.
  const sourceTypes = new Set(rows.map((r) => r.source_type));
  const allCafr =
    sourceTypes.size === 1 && sourceTypes.has("cafr_extraction");
  const yearCounts = new Map<number, number>();
  for (const r of rows) {
    if (r.fee_year != null) {
      yearCounts.set(r.fee_year, (yearCounts.get(r.fee_year) ?? 0) + 1);
    }
  }
  let modeYear: number | null = null;
  let modeCount = 0;
  for (const [y, count] of yearCounts) {
    if (count > modeCount || (count === modeCount && y > (modeYear ?? -1))) {
      modeYear = y;
      modeCount = count;
    }
  }
  const advisorCount = new Set(
    rows.map((r) => r.consultant?.canonical_name ?? r.id),
  ).size;
  const subtitle = allCafr
    ? `${advisorCount} advisor${advisorCount === 1 ? "" : "s"}${
        modeYear ? ` · Sourced from FY${String(modeYear).slice(-2)} CAFR` : ""
      }`
    : `${advisorCount} advisor${advisorCount === 1 ? "" : "s"}`;

  // Group by mandate, then sort within each group: fee_year DESC primary,
  // fee_usd DESC NULLS LAST secondary, name tiebreak. Multi-year duplicates
  // for the same (firm, mandate) are NOT deduped -- the trajectory matters.
  const byMandate = new Map<string, ConsultantRow[]>();
  for (const r of rows) {
    if (!byMandate.has(r.mandate_type)) byMandate.set(r.mandate_type, []);
    byMandate.get(r.mandate_type)!.push(r);
  }
  for (const arr of byMandate.values()) {
    arr.sort((a, b) => {
      const ay = a.fee_year ?? -Infinity;
      const by = b.fee_year ?? -Infinity;
      if (ay !== by) return by - ay;
      const af = a.fee_usd != null ? Number(a.fee_usd) : -Infinity;
      const bf = b.fee_usd != null ? Number(b.fee_usd) : -Infinity;
      if (af !== bf) return bf - af;
      return (a.consultant?.canonical_name ?? "").localeCompare(
        b.consultant?.canonical_name ?? "",
      );
    });
  }
  const knownMandates = CONSULTANT_MANDATE_ORDER.filter((m) =>
    byMandate.has(m),
  );
  const unknownMandates = Array.from(byMandate.keys())
    .filter((m) => !CONSULTANT_MANDATE_ORDER.includes(m as never))
    .sort();
  const orderedMandates = [...knownMandates, ...unknownMandates];

  return (
    <section className="card-surface">
      <div className="px-4 py-3 border-b border-line">
        <div className="text-[13px] font-medium text-ink">
          Investment Consultants
        </div>
        <div className="mt-0.5 text-[12px] text-ink-muted">{subtitle}</div>
      </div>
      <div className="divide-y divide-line">
        {orderedMandates.map((mandate) => {
          const mandateRows = byMandate.get(mandate)!;
          const label =
            CONSULTANT_MANDATE_LABEL[mandate] ?? mandate.replace(/_/g, " ");
          return (
            <div key={mandate} className="px-4 py-3">
              <div className="text-[10.5px] text-ink-faint uppercase tracking-wide mb-1.5">
                {label}
              </div>
              <div>
                {mandateRows.map((row) => (
                  <ConsultantLineItem key={row.id} row={row} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ConsultantLineItem({ row }: { row: ConsultantRow }) {
  const linkUrl = row.source_url ?? row.document?.source_url ?? null;
  const excerpt = row.source_excerpt
    ? row.source_excerpt.length > 250
      ? row.source_excerpt.slice(0, 250) + "…"
      : row.source_excerpt
    : null;
  const feeNum = row.fee_usd != null ? Number(row.fee_usd) : null;
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 sm:gap-x-4 items-center text-[13px] h-7">
      <div className="text-ink truncate">
        {row.consultant?.canonical_name ?? "—"}
      </div>
      <div className="num tabular-nums text-ink-muted text-right">
        {feeNum != null ? (
          formatUSD(feeNum)
        ) : (
          <span className="text-ink-faint">—</span>
        )}
      </div>
      <div className="num tabular-nums text-[11.5px] text-ink-faint text-right">
        {row.fee_year ? `FY${String(row.fee_year).slice(-2)}` : "—"}
      </div>
      <div className="text-right w-4">
        {linkUrl ? (
          <a
            href={linkUrl}
            target="_blank"
            rel="noreferrer"
            className="text-ink-faint hover:text-accent-hi"
            title={excerpt ?? "View source document"}
            aria-label="View source document"
          >
            ↗
          </a>
        ) : (
          <span className="text-ink-faint" aria-hidden>
            ·
          </span>
        )}
      </div>
    </div>
  );
}
