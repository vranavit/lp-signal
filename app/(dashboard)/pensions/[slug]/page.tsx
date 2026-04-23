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
import {
  privateMarketsUnfundedUsd,
  PRIVATE_MARKETS_CLASSES,
  unfundedUsd,
} from "@/lib/relevance/unfunded";

export const dynamic = "force-dynamic";

type Allocation = {
  id: string;
  as_of_date: string;
  asset_class: string;
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

  // Latest allocation snapshot for this plan. Sort DESC by as_of_date so the
  // first row's date is the newest; render only that snapshot's rows.
  const { data: allocData } = await supabase
    .from("pension_allocations")
    .select(
      "id, as_of_date, asset_class, target_pct, target_min_pct, target_max_pct, actual_pct, actual_usd, total_plan_aum_usd, source_document_id, source_page, source_quote, confidence, preliminary",
    )
    .eq("plan_id", plan.id)
    .order("as_of_date", { ascending: false })
    .order("asset_class", { ascending: true });

  const rows = (allocData ?? []) as Allocation[];
  const latestAsOf = rows[0]?.as_of_date ?? null;
  const latest = rows.filter((r) => r.as_of_date === latestAsOf);
  const totalAum =
    latest.find((r) => r.total_plan_aum_usd)?.total_plan_aum_usd ?? null;

  // Unfunded budget = (target − actual) / 100 × AUM, capped at zero, summed
  // across private-markets asset classes. This is the cold-email headline.
  const headlineUnfunded = privateMarketsUnfundedUsd(latest);
  const perClassUnfunded: Array<{ asset_class: string; unfunded_usd: number }> =
    latest
      .filter((r) =>
        (PRIVATE_MARKETS_CLASSES as readonly string[]).includes(r.asset_class),
      )
      .map((r) => ({ asset_class: r.asset_class, unfunded_usd: unfundedUsd(r) }))
      .filter((r) => r.unfunded_usd > 0)
      .sort((a, b) => b.unfunded_usd - a.unfunded_usd);

  // Detected policy changes for this plan (most recent first).
  const { data: policyChanges } = await supabase
    .from("allocation_policy_changes")
    .select(
      "id, asset_class, previous_target_pct, new_target_pct, change_pp, change_direction, as_of_date_previous, as_of_date_new, implied_usd_delta",
    )
    .eq("plan_id", plan.id)
    .order("as_of_date_new", { ascending: false })
    .order("asset_class", { ascending: true });

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
                  aumUsd={totalAum ?? plan.aum_usd}
                />
              </div>
              <div className="text-[11px] text-ink-faint mt-1 flex items-center justify-end gap-1">
                <span>as of {latestAsOf ? formatDate(latestAsOf) : "—"}</span>
                <StaleIndicator
                  date={latestAsOf}
                  cutoffDays={90}
                  kind="allocation"
                />
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
          value={formatUSD(totalAum ?? plan.aum_usd)}
          sublabel={latestAsOf ? `as of ${formatDate(latestAsOf)}` : undefined}
        />
        <StatCard
          label="Transaction signals"
          value={String(signalsCount ?? 0)}
          sublabel="all time, accepted + preliminary"
        />
        <StatCard
          label="Allocation rows"
          value={String(latest.length)}
          sublabel={
            latestAsOf
              ? `${latest.length === 0 ? "none" : "classes in latest policy"}`
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
                  . Gap = target − actual. Positive gap = unfunded budget.
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

        {latest.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-ink-muted">
            Ingest this plan&apos;s CAFR to populate allocation data.
          </div>
        ) : (
          <AllocationTable rows={latest} totalAum={totalAum} />
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
                        <span className="inline-flex items-center gap-1">
                          <span className="num tabular-nums text-[11.5px] text-ink-muted">
                            {formatDate(
                              s.document?.meeting_date ?? s.created_at,
                            )}
                          </span>
                          <StaleIndicator
                            date={s.document?.meeting_date ?? s.created_at}
                            cutoffDays={30}
                            kind="signal"
                          />
                        </span>
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
    </div>
  );
}

function AllocationTable({
  rows,
  totalAum,
}: {
  rows: Allocation[];
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
          {rows.map((r) => {
            const gapPct =
              r.actual_pct != null ? r.target_pct - r.actual_pct : null;
            const gapUsd =
              gapPct != null && totalAum
                ? Math.round((gapPct / 100) * totalAum)
                : null;
            const tone =
              gapPct == null
                ? "neutral"
                : gapPct > 0.5
                ? "positive"
                : gapPct < -0.5
                ? "negative"
                : "neutral";
            return (
              <tr
                key={r.id}
                className="h-11 border-b border-line last:border-b-0 odd:bg-black/[0.015] dark:odd:bg-white/[0.02]"
                title={r.source_quote ?? undefined}
              >
                <td className="px-4 py-0 align-middle text-ink">
                  <span>{r.asset_class}</span>
                </td>
                <td className="px-4 py-0 align-middle">
                  <ConfidenceBadge
                    confidence={r.confidence}
                    priority={100}
                    preliminary={r.preliminary}
                  />
                </td>
                <td className="px-4 py-0 align-middle text-right num tabular-nums text-ink">
                  {fmtPct(r.target_pct)}
                </td>
                <td className="px-4 py-0 align-middle text-right num tabular-nums text-ink-muted">
                  {r.target_min_pct != null && r.target_max_pct != null
                    ? `${fmtPct(r.target_min_pct)} – ${fmtPct(r.target_max_pct)}`
                    : "—"}
                </td>
                <td className="px-4 py-0 align-middle text-right num tabular-nums text-ink-muted">
                  {r.actual_pct != null ? fmtPct(r.actual_pct) : "—"}
                </td>
                <td className="px-4 py-0 align-middle text-right">
                  {gapPct != null ? (
                    <Extrapolated method="target% − actual%">
                      <span
                        className={
                          "num tabular-nums font-medium " +
                          (tone === "positive"
                            ? "text-green-700 dark:text-green-400"
                            : tone === "negative"
                            ? "text-red-700 dark:text-red-400"
                            : "text-ink-muted")
                        }
                      >
                        {gapPct > 0 ? "+" : ""}
                        {fmtPct(gapPct)}
                      </span>
                    </Extrapolated>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
                <td className="px-4 py-0 align-middle text-right">
                  {gapUsd != null ? (
                    <Extrapolated method="gap(pp) ÷ 100 × plan AUM">
                      <span
                        className={
                          "num tabular-nums " +
                          (gapUsd > 0
                            ? "text-green-700 dark:text-green-400"
                            : gapUsd < 0
                            ? "text-red-700 dark:text-red-400"
                            : "text-ink-muted")
                        }
                      >
                        {gapUsd > 0 ? "+" : gapUsd < 0 ? "−" : ""}
                        {formatUSD(Math.abs(gapUsd))}
                      </span>
                    </Extrapolated>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
                <td className="px-2 py-0 align-middle text-right">
                  <AuditTrailTrigger
                    documentId={r.source_document_id}
                    sourcePage={r.source_page}
                    sourceQuote={r.source_quote}
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
}: {
  plan: {
    scrape_url: string | null;
    last_scraped_at: string | null;
    aum_usd: number | null;
  };
  latestAsOf: string | null;
  website: string | null;
}) {
  const homeUrl = website ?? plan.scrape_url ?? null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
      <span>
        AUM <span className="num tabular-nums text-ink">{formatUSD(plan.aum_usd)}</span>
      </span>
      {latestAsOf ? (
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
