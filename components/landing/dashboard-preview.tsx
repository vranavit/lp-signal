import { ArrowUpRight } from "lucide-react";
import { formatUSD } from "@/lib/utils";
import type { OutreachPreviewRow, UnderweightRow } from "./shared";

/**
 * The dark terminal band. Off-white on navy #0F1B3D. Two "product
 * screenshot" recreations side-by-side, both rendering from live queries,
 * both styled for the dark surface. This is the section that has to
 * convince a skeptical institutional buyer that a working product exists.
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
    <section
      className="relative overflow-hidden"
      style={{ backgroundColor: "#0F1B3D", color: "#F5F5F4" }}
    >
      {/* Faint grid overlay for terminal feel */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      <div className="relative mx-auto max-w-[1200px] px-6 py-20 sm:py-28">
        <div className="mb-14 max-w-3xl">
          <div
            className="text-[11px] uppercase font-medium"
            style={{ letterSpacing: "0.1em", color: "rgba(245,245,244,0.55)" }}
          >
            The product
          </div>
          <h2
            className="mt-3 font-serif font-normal text-[48px] sm:text-[56px] leading-[1.02]"
            style={{ letterSpacing: "-0.02em", color: "#FAFAF9" }}
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
            style={{ color: "rgba(245,245,244,0.9)", letterSpacing: "-0.005em" }}
          >
            Every number traces to its source document. One click to verify.
          </p>
        </div>
      </div>
    </section>
  );
}

// ── LEFT: CalSTRS profile recreation (dark) ──────────────────────────────

function CalstrsProfileCard({
  rows,
  unfundedTotal,
}: {
  rows: UnderweightRow[];
  unfundedTotal: number;
}) {
  return (
    <div
      className="rounded-[12px] overflow-hidden border"
      style={{
        backgroundColor: "#1A2A5C",
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      <div
        className="px-5 py-3 flex items-center justify-between border-b"
        style={{
          backgroundColor: "#14234E",
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        <span
          className="font-mono text-[10.5px] uppercase"
          style={{ letterSpacing: "0.1em", color: "rgba(245,245,244,0.7)" }}
        >
          CALSTRS
        </span>
        <ArrowUpRight
          className="h-3.5 w-3.5"
          style={{ color: "rgba(245,245,244,0.5)" }}
        />
      </div>
      <div className="px-6 py-7">
        <div
          className="font-mono text-[10.5px] uppercase"
          style={{ letterSpacing: "0.1em", color: "rgba(245,245,244,0.55)" }}
        >
          Unfunded private-markets budget
        </div>
        <div
          className="mt-1.5 font-mono tabular-nums font-bold leading-none text-[48px] sm:text-[56px]"
          style={{ letterSpacing: "-0.025em", color: "#FAFAF9" }}
        >
          {formatUSD(unfundedTotal)}
        </div>
        <div
          className="mt-3 text-[11.5px]"
          style={{ color: "rgba(245,245,244,0.55)" }}
        >
          CalSTRS · fiscal year end 2025-06-30 · latest CAFR
        </div>

        <div className="mt-6">
          <div
            className="font-mono text-[10px] uppercase mb-3"
            style={{
              letterSpacing: "0.1em",
              color: "rgba(245,245,244,0.45)",
            }}
          >
            Top underweight asset classes
          </div>
          {rows.length === 0 ? (
            <div
              className="text-[13px]"
              style={{ color: "rgba(245,245,244,0.55)" }}
            >
              No underweight positions currently.
            </div>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr style={{ color: "rgba(245,245,244,0.45)" }}>
                  <DarkTh>Asset</DarkTh>
                  <DarkTh className="text-right">Target</DarkTh>
                  <DarkTh className="text-right">Actual</DarkTh>
                  <DarkTh className="text-right">Gap</DarkTh>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.asset_class}
                    style={{
                      borderBottom:
                        i < rows.length - 1
                          ? "1px solid rgba(255,255,255,0.06)"
                          : "none",
                    }}
                  >
                    <td
                      className="py-2.5"
                      style={{ color: "#FAFAF9" }}
                    >
                      {r.asset_class}
                    </td>
                    <td
                      className="py-2.5 text-right font-mono tabular-nums"
                      style={{ color: "rgba(245,245,244,0.8)" }}
                    >
                      {r.target_pct}%
                    </td>
                    <td
                      className="py-2.5 text-right font-mono tabular-nums"
                      style={{ color: "rgba(245,245,244,0.55)" }}
                    >
                      {r.actual_pct}%
                    </td>
                    <td
                      className="py-2.5 text-right font-mono tabular-nums font-semibold"
                      style={{ color: "#6EE7B7" }}
                    >
                      +{formatUSD(r.unfunded_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div
        className="px-6 py-3 border-t"
        style={{
          borderColor: "rgba(255,255,255,0.08)",
          backgroundColor: "#14234E",
        }}
      >
        <span
          className="text-[11px]"
          style={{ color: "rgba(245,245,244,0.55)" }}
        >
          Live from{" "}
          <span className="font-mono">/pensions/calstrs</span>
        </span>
      </div>
    </div>
  );
}

// ── RIGHT: outreach filter recreation (dark) ─────────────────────────────

function OutreachCard({ outreach }: { outreach: OutreachPreviewRow[] }) {
  return (
    <div
      className="rounded-[12px] overflow-hidden border"
      style={{
        backgroundColor: "#1A2A5C",
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      <div
        className="px-5 py-3 flex items-center justify-between border-b"
        style={{
          backgroundColor: "#14234E",
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        <span
          className="font-mono text-[10.5px] uppercase"
          style={{ letterSpacing: "0.1em", color: "rgba(245,245,244,0.7)" }}
        >
          COLD OUTREACH TARGETING
        </span>
        <ArrowUpRight
          className="h-3.5 w-3.5"
          style={{ color: "rgba(245,245,244,0.5)" }}
        />
      </div>
      <div className="px-6 py-7">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div
              className="font-mono text-[10.5px] uppercase"
              style={{
                letterSpacing: "0.1em",
                color: "rgba(245,245,244,0.55)",
              }}
            >
              Filter
            </div>
            <div
              className="mt-1 text-[13.5px]"
              style={{ color: "#FAFAF9" }}
            >
              Unfunded PE/RE budget{" "}
              <span
                className="font-mono tabular-nums"
                style={{ color: "#93C5FD" }}
              >
                ≥ $1B
              </span>
            </div>
          </div>
          <div className="text-right">
            <div
              className="font-mono text-[10.5px] uppercase"
              style={{
                letterSpacing: "0.1em",
                color: "rgba(245,245,244,0.55)",
              }}
            >
              Matches
            </div>
            <div
              className="mt-1 font-mono tabular-nums font-semibold text-[20px]"
              style={{ color: "#FAFAF9" }}
            >
              {outreach.length}
            </div>
          </div>
        </div>

        {outreach.length === 0 ? (
          <div
            className="mt-6 text-[13px]"
            style={{ color: "rgba(245,245,244,0.55)" }}
          >
            No plans match this filter yet.
          </div>
        ) : (
          <table className="mt-6 w-full border-collapse text-[13px]">
            <thead>
              <tr style={{ color: "rgba(245,245,244,0.45)" }}>
                <DarkTh>Plan</DarkTh>
                <DarkTh className="text-right">Country</DarkTh>
                <DarkTh className="text-right">Unfunded</DarkTh>
              </tr>
            </thead>
            <tbody>
              {outreach.map((p, i) => (
                <tr
                  key={p.plan_id}
                  style={{
                    borderBottom:
                      i < outreach.length - 1
                        ? "1px solid rgba(255,255,255,0.06)"
                        : "none",
                  }}
                >
                  <td
                    className="py-2.5 truncate max-w-[220px]"
                    style={{ color: "#FAFAF9" }}
                  >
                    {p.plan_name}
                  </td>
                  <td
                    className="py-2.5 text-right font-mono tabular-nums"
                    style={{ color: "rgba(245,245,244,0.55)" }}
                  >
                    {p.country}
                  </td>
                  <td
                    className="py-2.5 text-right font-mono tabular-nums font-semibold"
                    style={{ color: "#FAFAF9" }}
                  >
                    {formatUSD(p.unfunded_usd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div
        className="px-6 py-3 border-t"
        style={{
          borderColor: "rgba(255,255,255,0.08)",
          backgroundColor: "#14234E",
        }}
      >
        <span
          className="text-[11px]"
          style={{ color: "rgba(245,245,244,0.55)" }}
        >
          Live from <span className="font-mono">/outreach</span>
        </span>
      </div>
    </div>
  );
}

function DarkTh({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`text-left font-normal text-[10px] uppercase py-2 ${className}`}
      style={{ letterSpacing: "0.08em" }}
    >
      {children}
    </th>
  );
}
