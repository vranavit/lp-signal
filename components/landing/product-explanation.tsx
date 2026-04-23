import Link from "next/link";
import { formatUSD, formatDate } from "@/lib/utils";
import type {
  UnderweightRow,
  PolicyChangeRow,
  GpSignal,
} from "./shared";

/**
 * Three stacked claim+proof blocks that spell out what Allocus actually
 * surfaces. Each block: 40% pull-quote + 60% live-data card. The goal is
 * to turn abstract product copy into three concrete, source-verified
 * examples — visitor reads three claims, sees three pieces of live data
 * backing each claim, and believes the product is real.
 */
export function ProductExplanation({
  calstrsRows,
  calstrsUnfundedPmTotal,
  latestPolicyChange,
  latestGpSignal,
}: {
  calstrsRows: UnderweightRow[];
  calstrsUnfundedPmTotal: number;
  latestPolicyChange: PolicyChangeRow | null;
  latestGpSignal: GpSignal | null;
}) {
  return (
    <section id="proof" className="bg-neutral-100 border-t border-neutral-200">
      <div className="mx-auto max-w-[1200px] px-6 py-20 sm:py-24">
        <div className="mb-14 max-w-3xl">
          <div
            className="text-[11px] uppercase text-neutral-500 font-medium"
            style={{ letterSpacing: "0.1em" }}
          >
            What Allocus shows you
          </div>
          <h2
            className="mt-3 font-serif font-normal text-navy text-[40px] sm:text-[48px] leading-[1.02]"
            style={{ letterSpacing: "-0.02em" }}
          >
            Here&apos;s what that looks like in practice.
          </h2>
        </div>

        <div className="flex flex-col gap-4">
          <ClaimBlock
            index="01"
            claim={
              calstrsUnfundedPmTotal > 0 ? (
                <>
                  CalSTRS has{" "}
                  <span className="text-navy">
                    {formatUSD(calstrsUnfundedPmTotal)}
                  </span>{" "}
                  of private markets budget they haven&apos;t deployed.
                </>
              ) : (
                <>
                  CalSTRS private markets allocation tracked against live
                  policy targets.
                </>
              )
            }
            card={<CalstrsGapCard rows={calstrsRows} />}
          />
          <ClaimBlock
            index="02"
            claim={
              latestPolicyChange ? (
                <>
                  {latestPolicyChange.plan_name} just{" "}
                  {latestPolicyChange.change_direction === "decrease"
                    ? "cut"
                    : "raised"}{" "}
                  their{" "}
                  {prettyAssetClass(latestPolicyChange.asset_class)} target by{" "}
                  <span className="text-navy">
                    {formatChangePp(latestPolicyChange.change_pp)}
                  </span>
                  .
                </>
              ) : (
                <>
                  We flag every target-allocation change between CAFR
                  snapshots, automatically.
                </>
              )
            }
            card={<PolicyChangeCard change={latestPolicyChange} />}
          />
          <ClaimBlock
            index="03"
            claim={
              latestGpSignal ? (
                <>
                  {latestGpSignal.gp_name} just closed a fund at{" "}
                  <span className="text-navy">
                    {latestGpSignal.commitment_amount_usd
                      ? formatUSD(latestGpSignal.commitment_amount_usd)
                      : "—"}
                  </span>
                  .
                </>
              ) : (
                <>
                  GP press releases flow into Allocus on the day they publish.
                </>
              )
            }
            card={<GpSignalCard signal={latestGpSignal} />}
          />
        </div>
      </div>
    </section>
  );
}

function ClaimBlock({
  index,
  claim,
  card,
}: {
  index: string;
  claim: React.ReactNode;
  card: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-neutral-200 rounded-[12px] overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr]">
        {/* LEFT: pull-quote */}
        <div className="p-8 sm:p-10 flex flex-col lg:border-r border-neutral-200">
          <div
            className="font-mono text-[12px] text-neutral-500 tabular-nums"
            style={{ letterSpacing: "0.08em" }}
          >
            {index}
          </div>
          <blockquote
            className="mt-5 font-serif font-normal text-neutral-700 text-[26px] sm:text-[30px] leading-[1.22]"
            style={{ letterSpacing: "-0.015em" }}
          >
            {claim}
          </blockquote>
        </div>
        {/* RIGHT: live card */}
        <div className="bg-neutral-50 lg:border-l border-t lg:border-t-0 border-neutral-200">
          {card}
        </div>
      </div>
    </div>
  );
}

// ── Card 1: CalSTRS top-3 underweight ─────────────────────────────────────

function CalstrsGapCard({ rows }: { rows: UnderweightRow[] }) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b border-neutral-200 bg-white flex items-center justify-between">
        <span
          className="font-mono text-[10.5px] uppercase text-neutral-500"
          style={{ letterSpacing: "0.08em" }}
        >
          CalSTRS — top 3 underweight
        </span>
        <span className="font-mono text-[10.5px] text-neutral-500 tabular-nums">
          {rows.length > 0 ? "Latest CAFR" : ""}
        </span>
      </div>
      <div className="px-6 py-6 flex-1">
        {rows.length === 0 ? (
          <div className="text-[13px] text-neutral-500">
            No underweight positions currently.
          </div>
        ) : (
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="text-neutral-500 border-b border-neutral-200">
                <Th>Asset class</Th>
                <Th className="text-right">Target</Th>
                <Th className="text-right">Actual</Th>
                <Th className="text-right">Gap ($)</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.asset_class}
                  className={
                    i < rows.length - 1 ? "border-b border-neutral-100" : ""
                  }
                >
                  <td className="py-3 text-neutral-950">{r.asset_class}</td>
                  <td className="py-3 text-right font-mono tabular-nums text-neutral-700">
                    {r.target_pct}%
                  </td>
                  <td className="py-3 text-right font-mono tabular-nums text-neutral-500">
                    {r.actual_pct}%
                  </td>
                  <td className="py-3 text-right font-mono tabular-nums font-semibold text-emerald-700">
                    +{formatUSD(r.unfunded_usd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="px-6 py-3 border-t border-neutral-200 bg-white">
        <Link
          href="/pensions/calstrs"
          className="text-[12px] text-navy hover:underline"
        >
          Live on /pensions/calstrs →
        </Link>
      </div>
    </div>
  );
}

// ── Card 2: latest policy change ─────────────────────────────────────────

function PolicyChangeCard({ change }: { change: PolicyChangeRow | null }) {
  if (!change) {
    return (
      <div className="h-full flex items-center px-6 py-8 text-[13px] text-neutral-500">
        No policy changes detected yet.
      </div>
    );
  }
  const tone =
    change.change_direction === "increase"
      ? "text-emerald-700"
      : change.change_direction === "decrease"
      ? "text-rose-700"
      : "text-neutral-700";
  const arrow =
    change.change_direction === "increase"
      ? "↑"
      : change.change_direction === "decrease"
      ? "↓"
      : "→";
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b border-neutral-200 bg-white flex items-center justify-between">
        <span
          className="font-mono text-[10.5px] uppercase text-neutral-500"
          style={{ letterSpacing: "0.08em" }}
        >
          Policy change — most recent
        </span>
        <span className="font-mono tabular-nums text-[10.5px] text-neutral-500">
          {formatDate(change.as_of_date_new)}
        </span>
      </div>
      <div className="px-6 py-6 flex-1 flex flex-col gap-4">
        <div>
          <div className="text-[15px] font-semibold text-navy">
            {change.plan_name}
          </div>
          <div className="mt-0.5 text-[12.5px] text-neutral-500">
            Asset class: {prettyAssetClass(change.asset_class)}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-0 border-y border-neutral-200 py-4">
          <Stat
            label="Previous"
            value={`${change.previous_target_pct}%`}
            mono
          />
          <Stat
            label="New"
            value={`${change.new_target_pct}%`}
            mono
            emphasis
          />
          <Stat
            label={
              change.change_direction === "decrease" ? "Delta" : "Delta"
            }
            value={`${arrow} ${formatChangePp(Math.abs(change.change_pp))}`}
            mono
            className={tone}
          />
        </div>

        {change.implied_usd_delta != null ? (
          <div>
            <div
              className="font-mono text-[10.5px] uppercase text-neutral-500"
              style={{ letterSpacing: "0.08em" }}
            >
              Implied budget shift
            </div>
            <div
              className={`mt-1 font-mono tabular-nums font-semibold text-[22px] ${tone}`}
            >
              {change.implied_usd_delta > 0 ? "+" : ""}
              {formatUSD(change.implied_usd_delta)}
            </div>
          </div>
        ) : null}
      </div>
      <div className="px-6 py-3 border-t border-neutral-200 bg-white">
        <Link
          href="/signals?type=policy"
          className="text-[12px] text-navy hover:underline"
        >
          Live on /signals?type=policy →
        </Link>
      </div>
    </div>
  );
}

// ── Card 3: latest GP fund-close signal ──────────────────────────────────

function GpSignalCard({ signal }: { signal: GpSignal | null }) {
  if (!signal) {
    return (
      <div className="h-full flex items-center px-6 py-8 text-[13px] text-neutral-500">
        No recent GP signal available.
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b border-neutral-200 bg-white flex items-center justify-between">
        <span
          className="font-mono text-[10.5px] uppercase text-neutral-500"
          style={{ letterSpacing: "0.08em" }}
        >
          GP signal — most recent
        </span>
        <span className="font-mono tabular-nums text-[10.5px] text-neutral-500">
          {signal.created_at.slice(0, 10)}
        </span>
      </div>
      <div className="px-6 py-6 flex-1 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[15px] font-semibold text-navy">
              {signal.gp_name}
            </div>
            {signal.asset_class ? (
              <div className="mt-1 inline-flex">
                <span className="font-mono text-[10px] uppercase text-neutral-600 bg-white border border-neutral-200 rounded-[4px] px-1.5 py-0.5">
                  {signal.asset_class}
                </span>
              </div>
            ) : null}
          </div>
          <div className="text-right shrink-0">
            <div
              className="font-mono text-[10.5px] uppercase text-neutral-500"
              style={{ letterSpacing: "0.08em" }}
            >
              Fund size
            </div>
            <div className="mt-1 font-mono tabular-nums font-semibold text-navy text-[22px]">
              {signal.commitment_amount_usd
                ? formatUSD(signal.commitment_amount_usd)
                : "—"}
            </div>
          </div>
        </div>
        <p className="text-[13px] text-neutral-700 leading-relaxed line-clamp-3">
          {signal.summary}
        </p>
      </div>
      <div className="px-6 py-3 border-t border-neutral-200 bg-white">
        <Link href="/signals" className="text-[12px] text-navy hover:underline">
          Live on /signals →
        </Link>
      </div>
    </div>
  );
}

// ── Small shared sub-components ───────────────────────────────────────────

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`text-left font-normal text-[10.5px] uppercase text-neutral-500 py-2 ${className}`}
      style={{ letterSpacing: "0.06em" }}
    >
      {children}
    </th>
  );
}

function Stat({
  label,
  value,
  mono = false,
  emphasis = false,
  className = "",
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div>
      <div
        className="text-[10.5px] uppercase text-neutral-500"
        style={{ letterSpacing: "0.08em" }}
      >
        {label}
      </div>
      <div
        className={`${mono ? "font-mono tabular-nums" : ""} ${emphasis ? "text-navy font-semibold" : "text-neutral-800"} mt-1 text-[16px] ${className}`}
      >
        {value}
      </div>
    </div>
  );
}

function prettyAssetClass(ac: string): string {
  const map: Record<string, string> = {
    PE: "Private Equity",
    Infra: "Infrastructure",
    Credit: "Credit",
    RE: "Real Estate",
    VC: "Venture",
    Other: "Other",
  };
  return map[ac] ?? ac;
}

function formatChangePp(pp: number): string {
  const abs = Math.abs(pp);
  return `${abs.toFixed(abs < 10 ? 1 : 0)}pp`;
}
