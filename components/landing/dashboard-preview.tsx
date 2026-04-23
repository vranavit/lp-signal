import { ArrowUpRight } from "lucide-react";
import { formatUSD } from "@/lib/utils";
import type { OutreachPreviewRow, UnderweightRow } from "./shared";

/**
 * Light-mode dashboard preview. Two "product screenshot" cards side-by-side,
 * both rendering from live queries. Section sits on neutral-100 with navy
 * headers and subtle navy-tinted card chrome.
 */
export function DashboardPreview({
  calstrsRows,
  outreach,
}: {
  calstrsRows: UnderweightRow[];
  outreach: OutreachPreviewRow[];
}) {
  const calstrsUnfundedTotal = calstrsRows.reduce(
    (acc, r) => acc + r.unfunded_usd,
    0,
  );
  return (
    <section className="relative overflow-hidden bg-neutral-100 border-t border-neutral-200">
      {/* Faint navy grid for terminal feel */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(15,27,61,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,27,61,0.03) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      <div className="relative mx-auto max-w-[1200px] px-6 py-20 sm:py-28">
        <div className="mb-14 max-w-3xl">
          <div
            className="text-[11px] uppercase text-neutral-500 font-medium"
            style={{ letterSpacing: "0.1em" }}
          >
            The product
          </div>
          <h2
            className="mt-3 font-serif font-normal text-navy text-[48px] sm:text-[56px] leading-[1.02]"
            style={{ letterSpacing: "-0.02em" }}
          >
            Every signal. Source-verified.
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <CalstrsProfileCard
            rows={calstrsRows}
            unfundedTotal={calstrsUnfundedTotal}
          />
          <OutreachCard outreach={outreach} />
        </div>

        <div className="mt-16 sm:mt-20 max-w-2xl mx-auto text-center">
          <p
            className="font-serif italic text-[22px] sm:text-[24px] leading-[1.4]"
            style={{ color: "rgba(15,27,61,0.8)", letterSpacing: "-0.005em" }}
          >
            Every number traces to its source document. One click to verify.
          </p>
        </div>
      </div>
    </section>
  );
}

// ── LEFT: CalSTRS profile recreation ──────────────────────────────────────

function CalstrsProfileCard({
  rows,
  unfundedTotal,
}: {
  rows: UnderweightRow[];
  unfundedTotal: number;
}) {
  return (
    <div className="rounded-[12px] overflow-hidden border border-neutral-200 bg-white">
      <div
        className="px-5 py-3 flex items-center justify-between border-b border-neutral-200"
        style={{ backgroundColor: "rgba(15,27,61,0.06)" }}
      >
        <span
          className="font-mono text-[10.5px] uppercase text-navy font-semibold"
          style={{ letterSpacing: "0.1em" }}
        >
          CALSTRS
        </span>
        <ArrowUpRight className="h-3.5 w-3.5 text-navy/60" />
      </div>
      <div className="px-6 py-7">
        <div
          className="font-mono text-[10.5px] uppercase text-neutral-500"
          style={{ letterSpacing: "0.1em" }}
        >
          Unfunded private-markets budget
        </div>
        <div
          className="mt-1.5 font-mono tabular-nums font-bold leading-none text-[48px] sm:text-[56px] text-navy"
          style={{ letterSpacing: "-0.025em" }}
        >
          {formatUSD(unfundedTotal)}
        </div>
        <div className="mt-3 text-[11.5px] text-neutral-500">
          CalSTRS · fiscal year end 2025-06-30 · latest CAFR
        </div>

        <div className="mt-6">
          <div
            className="font-mono text-[10px] uppercase text-neutral-500 mb-3"
            style={{ letterSpacing: "0.1em" }}
          >
            Top underweight asset classes
          </div>
          {rows.length === 0 ? (
            <div className="text-[13px] text-neutral-500">
              No underweight positions currently.
            </div>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-neutral-500">
                  <LightTh>Asset</LightTh>
                  <LightTh className="text-right">Target</LightTh>
                  <LightTh className="text-right">Actual</LightTh>
                  <LightTh className="text-right">Gap</LightTh>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.asset_class}
                    className={
                      i < rows.length - 1
                        ? "border-b border-neutral-100"
                        : ""
                    }
                  >
                    <td className="py-2.5 text-neutral-950">
                      {r.asset_class}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums text-neutral-700">
                      {r.target_pct}%
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums text-neutral-500">
                      {r.actual_pct}%
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums font-semibold text-emerald-700">
                      +{formatUSD(r.unfunded_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="px-6 py-3 border-t border-neutral-200 bg-neutral-50">
        <span className="text-[11px] text-navy">
          Live from <span className="font-mono">/pensions/calstrs</span>
        </span>
      </div>
    </div>
  );
}

// ── RIGHT: outreach filter recreation ────────────────────────────────────

function OutreachCard({ outreach }: { outreach: OutreachPreviewRow[] }) {
  return (
    <div className="rounded-[12px] overflow-hidden border border-neutral-200 bg-white">
      <div
        className="px-5 py-3 flex items-center justify-between border-b border-neutral-200"
        style={{ backgroundColor: "rgba(15,27,61,0.06)" }}
      >
        <span
          className="font-mono text-[10.5px] uppercase text-navy font-semibold"
          style={{ letterSpacing: "0.1em" }}
        >
          COLD OUTREACH TARGETING
        </span>
        <ArrowUpRight className="h-3.5 w-3.5 text-navy/60" />
      </div>
      <div className="px-6 py-7">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div
              className="font-mono text-[10.5px] uppercase text-neutral-500"
              style={{ letterSpacing: "0.1em" }}
            >
              Filter
            </div>
            <div className="mt-1 text-[13.5px] text-neutral-950">
              Unfunded PE/RE budget{" "}
              <span className="font-mono tabular-nums text-navy">
                ≥ $1B
              </span>
            </div>
          </div>
          <div className="text-right">
            <div
              className="font-mono text-[10.5px] uppercase text-neutral-500"
              style={{ letterSpacing: "0.1em" }}
            >
              Matches
            </div>
            <div className="mt-1 font-mono tabular-nums font-semibold text-navy text-[20px]">
              {outreach.length}
            </div>
          </div>
        </div>

        {outreach.length === 0 ? (
          <div className="mt-6 text-[13px] text-neutral-500">
            No plans match this filter yet.
          </div>
        ) : (
          <table className="mt-6 w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-neutral-500">
                <LightTh>Plan</LightTh>
                <LightTh className="text-right">Country</LightTh>
                <LightTh className="text-right">Unfunded</LightTh>
              </tr>
            </thead>
            <tbody>
              {outreach.map((p, i) => (
                <tr
                  key={p.plan_id}
                  className={
                    i < outreach.length - 1
                      ? "border-b border-neutral-100"
                      : ""
                  }
                >
                  <td className="py-2.5 text-neutral-950 truncate max-w-[220px]">
                    {p.plan_name}
                  </td>
                  <td className="py-2.5 text-right font-mono tabular-nums text-neutral-500">
                    {p.country}
                  </td>
                  <td className="py-2.5 text-right font-mono tabular-nums font-semibold text-neutral-900">
                    {formatUSD(p.unfunded_usd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="px-6 py-3 border-t border-neutral-200 bg-neutral-50">
        <span className="text-[11px] text-navy">
          Live from <span className="font-mono">/outreach</span>
        </span>
      </div>
    </div>
  );
}

function LightTh({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`text-left font-normal text-[10px] uppercase py-2 border-b border-neutral-200 ${className}`}
      style={{ letterSpacing: "0.08em" }}
    >
      {children}
    </th>
  );
}
