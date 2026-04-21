import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { daysAgo, formatUSD } from "@/lib/utils";
import type { SignalWithPlan } from "@/lib/types";

function typeLabel(t: 1 | 2 | 3) {
  if (t === 1) return "T1 · Commitment";
  if (t === 2) return "T2 · Target Δ";
  return "T3 · Pacing";
}

function typeBadgeVariant(t: 1 | 2 | 3): "t1" | "t2" | "t3" {
  return t === 1 ? "t1" : t === 2 ? "t2" : "t3";
}

export function SignalTable({ rows }: { rows: SignalWithPlan[] }) {
  if (rows.length === 0) {
    return (
      <div className="panel p-8 text-center text-sm text-ink-muted">
        No signals yet. Run the scraper or wait for the 06:00 UTC cron.
      </div>
    );
  }

  return (
    <div className="border border-line">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-bg-subtle">
          <tr className="text-[10px] uppercase tracking-widest text-ink-faint">
            <th className="text-left font-normal px-3 py-2 w-[72px]">Score</th>
            <th className="text-left font-normal px-3 py-2 w-[120px]">Type</th>
            <th className="text-left font-normal px-3 py-2 w-[96px]">Asset</th>
            <th className="text-left font-normal px-3 py-2 w-[160px]">Plan</th>
            <th className="text-left font-normal px-3 py-2">Summary</th>
            <th className="text-right font-normal px-3 py-2 w-[96px]">Amount</th>
            <th className="text-right font-normal px-3 py-2 w-[64px]">Age</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-t border-line hover:bg-bg-subtle transition-colors"
            >
              <td className="px-3 py-2.5 align-top">
                <span className="mono text-ink tabular-nums">
                  {r.priority_score}
                </span>
              </td>
              <td className="px-3 py-2.5 align-top">
                <Badge variant={typeBadgeVariant(r.signal_type)}>
                  {typeLabel(r.signal_type)}
                </Badge>
              </td>
              <td className="px-3 py-2.5 align-top">
                <span className="mono text-[11px] uppercase tracking-widest text-ink-muted">
                  {r.asset_class ?? "—"}
                </span>
              </td>
              <td className="px-3 py-2.5 align-top">
                <div className="text-ink">{r.plan.name}</div>
                <div className="mono text-[10px] text-ink-faint">
                  {r.plan.country} · {formatUSD(r.plan.aum_usd)}
                </div>
              </td>
              <td className="px-3 py-2.5 align-top">
                <Link
                  href={`/signals/${r.id}`}
                  className="text-ink hover:text-accent"
                >
                  {r.summary}
                </Link>
                {r.seed_data ? (
                  <span className="ml-2">
                    <Badge variant="seed">Seed</Badge>
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2.5 align-top text-right">
                <span className="mono text-ink tabular-nums">
                  {formatUSD(r.commitment_amount_usd)}
                </span>
              </td>
              <td className="px-3 py-2.5 align-top text-right">
                <span className="mono text-[11px] text-ink-muted tabular-nums">
                  {daysAgo(r.created_at)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
