import { DemoRequestButton } from "@/components/landing/demo-request-modal";
import { formatUSD } from "@/lib/utils";
import type { CompactSignal, LiveStats, PipelineCounts } from "./shared";

export function Hero({
  stats,
  heroSignals,
  pipeline,
  renderedAt,
}: {
  stats: LiveStats;
  heroSignals: CompactSignal[];
  pipeline: PipelineCounts;
  renderedAt: Date;
}) {
  const shown = heroSignals.slice(0, 3);
  const stamp = renderedAt
    .toISOString()
    .replace("T", " ")
    .slice(0, 16)
    .concat(" UTC");

  return (
    <section className="hero-surface relative border-b border-neutral-200">
      <div className="relative mx-auto max-w-[1200px] px-6 pt-16 pb-20 sm:pt-20 sm:pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-12 lg:gap-14 items-start">
          {/* LEFT */}
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-neutral-200 bg-white text-[11.5px] text-neutral-700">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>
                {stats.pensionsMonitored == null
                  ? "Live data from US public pensions"
                  : `Live data from ${stats.pensionsMonitored} US public pensions`}
              </span>
            </div>

            <h1
              className="mt-7 font-serif font-normal text-navy text-[44px] sm:text-[56px] lg:text-[72px] leading-[0.98] max-w-[640px]"
              style={{ letterSpacing: "-0.03em" }}
            >
              LP intelligence for private markets fundraising.
            </h1>

            <p className="mt-6 max-w-[580px] text-[19px] sm:text-[22px] text-neutral-800 leading-[1.5]">
              Allocus tracks allocation gaps and commitment signals across
              US public pension funds, so private markets IR teams know
              which LPs have budget to deploy right now.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-5">
              <DemoRequestButton label="Request demo" />
              <a
                href="#proof"
                className="text-[13.5px] text-neutral-700 hover:text-navy transition-colors"
              >
                See live data ↓
              </a>
            </div>

            {/* 4-stat horizontal row with thin navy-200 vertical dividers */}
            <dl className="mt-12 grid grid-cols-2 sm:grid-cols-4 border-t border-neutral-200 pt-6 sm:divide-x divide-neutral-200">
              <HeroStat
                value={
                  stats.unfundedTotal == null
                    ? "—"
                    : formatUSD(stats.unfundedTotal)
                }
                label="Tracked unfunded budget"
                first
              />
              <HeroStat
                value={stats.signalsCount == null ? "—" : String(stats.signalsCount)}
                label="Commitment signals"
              />
              <HeroStat
                value={
                  stats.pensionsMonitored == null
                    ? "—"
                    : String(stats.pensionsMonitored)
                }
                label="Pensions monitored"
              />
              <HeroStat
                value={String(pipeline.policyChanges)}
                label="Policy changes detected"
              />
            </dl>

            {stats.pensionsWithActuals + stats.pensionsTargetOnly > 0 ? (
              <p className="mt-4 text-[12px] italic text-neutral-500 leading-snug max-w-xl">
                Based on {stats.pensionsWithActuals} pension
                {stats.pensionsWithActuals === 1 ? "" : "s"} with complete
                target + actual data.
                {stats.pensionsTargetOnly > 0 ? (
                  <>
                    {" "}
                    {stats.pensionsTargetOnly} additional pension
                    {stats.pensionsTargetOnly === 1 ? "" : "s"} tracked with
                    targets only — actuals unavailable from current CAFR, so
                    those plans are conservatively counted as zero gap.
                  </>
                ) : null}
              </p>
            ) : null}
          </div>

          {/* RIGHT — Bloomberg-style live feed panel */}
          <HeroDashboard shown={shown} stamp={stamp} />
        </div>
      </div>
    </section>
  );
}

function HeroStat({
  value,
  label,
  first = false,
}: {
  value: string;
  label: string;
  first?: boolean;
}) {
  return (
    <div className={first ? "pr-5 sm:pr-5" : "px-5 first:pl-0"}>
      <dt
        className="font-mono tabular-nums font-bold text-navy text-[28px] sm:text-[30px] leading-none"
        style={{ letterSpacing: "-0.02em" }}
      >
        {value}
      </dt>
      <dd
        className="mt-2.5 text-[11px] uppercase text-neutral-500 font-medium"
        style={{ letterSpacing: "0.1em" }}
      >
        {label}
      </dd>
    </div>
  );
}

function HeroDashboard({
  shown,
  stamp,
}: {
  shown: CompactSignal[];
  stamp: string;
}) {
  return (
    <div
      className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden"
      style={{ boxShadow: "inset 0 0 0 1px rgba(15, 27, 61, 0.04)" }}
    >
      {/* Navy header bar */}
      <div
        className="h-12 px-4 flex items-center justify-between"
        style={{ backgroundColor: "#0F1B3D" }}
      >
        <span
          className="text-[11px] text-white font-semibold"
          style={{ letterSpacing: "0.1em" }}
        >
          LIVE SIGNAL FEED
        </span>
        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span
            className="font-mono tabular-nums text-[10px] text-white/80"
            style={{ letterSpacing: "0.04em" }}
          >
            UPDATED {stamp}
          </span>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="px-4 py-6 text-[12.5px] text-neutral-500">
          Live preview unavailable.
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {shown.map((s) => {
            const entity = s.plan_name ?? s.gp_name ?? "—";
            const date =
              s.meeting_date ??
              (s.created_at ? s.created_at.slice(0, 10) : null);
            return (
              <li key={s.id} className="px-4 py-4 min-h-[92px]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-[15px] font-semibold text-navy truncate">
                      {entity}
                    </span>
                    {s.asset_class ? (
                      <span className="shrink-0 font-mono text-[10px] uppercase text-neutral-600 bg-neutral-100 rounded-[4px] px-1.5 py-0.5">
                        {s.asset_class}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono tabular-nums text-[20px] font-semibold text-neutral-900 leading-none">
                      {s.commitment_amount_usd
                        ? formatUSD(s.commitment_amount_usd)
                        : "—"}
                    </div>
                    <div className="font-mono tabular-nums text-[11px] text-neutral-500 mt-1.5">
                      {date ?? "—"}
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[13px] text-neutral-600 leading-snug line-clamp-2">
                  {s.summary}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="px-4 py-2.5 border-t border-neutral-200 bg-neutral-50">
        <span className="text-[11px] text-neutral-500">
          Commitment signals (T1) from board minutes and GP press releases.
        </span>
      </div>
    </div>
  );
}
