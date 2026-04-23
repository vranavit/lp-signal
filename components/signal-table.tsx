"use client";

import { Badge } from "@/components/ui/badge";
import { AuditTrailTrigger } from "@/components/audit-trail-modal";
import { daysAgo, formatPriorityScore, formatUSD } from "@/lib/utils";
import type { SignalWithDoc } from "@/components/signals-workspace";

function typeLabel(t: 1 | 2 | 3) {
  if (t === 1) return "T1 Commitment";
  if (t === 2) return "T2 Target Δ";
  return "T3 Pacing";
}

function typeBadgeVariant(t: 1 | 2 | 3): "t1" | "t2" | "t3" {
  return t === 1 ? "t1" : t === 2 ? "t2" : "t3";
}

function priorityTone(score: number): "hi" | "mid" | "lo" {
  if (score >= 75) return "hi";
  if (score >= 50) return "mid";
  return "lo";
}

function RelevanceCell({ score }: { score: number }) {
  const tone =
    score >= 70 ? "hi" : score >= 40 ? "mid" : "lo";
  const color =
    tone === "hi"
      ? "text-accent-hi"
      : tone === "mid"
      ? "text-ink"
      : "text-ink-faint";
  return (
    <span className={`num tabular-nums text-[12.5px] ${color}`}>
      {score}
    </span>
  );
}

function ScoreCell({ score }: { score: number }) {
  const tone = priorityTone(score);
  const color =
    tone === "hi" ? "pri-hi" : tone === "mid" ? "pri-mid" : "pri-lo";
  const dot =
    tone === "hi"
      ? "bg-pri-hi"
      : tone === "mid"
      ? "bg-ink-dim"
      : "border border-line-strong";
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`}
      />
      <span
        className={`num tabular-nums text-[13px] font-medium ${color}`}
      >
        {formatPriorityScore(score)}
      </span>
    </div>
  );
}

export function SignalTable({
  rows,
  onSelect,
  selectedId,
}: {
  rows: SignalWithDoc[];
  onSelect?: (id: string) => void;
  selectedId?: string | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="card-surface p-10 text-center">
        <div className="text-[13px] text-ink-muted">
          No signals match these filters.
        </div>
      </div>
    );
  }

  return (
    <div className="card-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-ink-faint">
              <Th className="text-right w-[44px]">#</Th>
              <Th className="w-[84px]">Score</Th>
              <Th className="w-[72px]">Fit</Th>
              <Th className="w-[132px]">Type</Th>
              <Th className="w-[72px]">Asset</Th>
              <Th className="w-[180px]">Plan</Th>
              <Th>Summary</Th>
              <Th className="text-right w-[104px]">Amount</Th>
              <Th className="text-right w-[56px]">Age</Th>
              <Th className="w-[32px]"> </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const isSelected = selectedId === r.id;
              return (
                <tr
                  key={r.id}
                  onClick={() => onSelect?.(r.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect?.(r.id);
                    }
                  }}
                  className={
                    "h-11 border-b border-line last:border-b-0 cursor-pointer transition-colors duration-150 " +
                    (isSelected
                      ? "bg-accent/5 outline outline-1 -outline-offset-1 outline-accent/40"
                      : "odd:bg-black/[0.015] dark:odd:bg-white/[0.02] hover:bg-bg-hover")
                  }
                >
                  <td className="px-4 py-0 align-middle text-right">
                    <span className="num tabular-nums text-[11px] text-ink-dim">
                      {(idx + 1).toString().padStart(3, "0")}
                    </span>
                  </td>
                  <td className="px-4 py-0 align-middle">
                    <ScoreCell score={r.priority_score} />
                  </td>
                  <td className="px-4 py-0 align-middle">
                    <RelevanceCell score={r.relevance_score ?? 0} />
                  </td>
                  <td className="px-4 py-0 align-middle">
                    <Badge variant={typeBadgeVariant(r.signal_type)}>
                      {typeLabel(r.signal_type)}
                    </Badge>
                  </td>
                  <td className="px-4 py-0 align-middle">
                    <span className="text-[12.5px] text-ink-muted">
                      {r.asset_class ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-0 align-middle">
                    <div className="text-[13px] text-ink leading-tight truncate">
                      {r.plan.name}
                    </div>
                    <div className="num text-[10.5px] text-ink-faint leading-tight mt-0.5">
                      {r.plan.country} · {formatUSD(r.plan.aum_usd)}
                    </div>
                  </td>
                  <td className="px-4 py-0 align-middle">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[13px] text-ink truncate">
                        {r.summary}
                      </span>
                      {r.preliminary ? (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[10.5px] text-ink-faint">
                          <span
                            aria-hidden
                            className="inline-block h-1.5 w-1.5 rounded-full bg-ink-dim"
                          />
                          preliminary
                        </span>
                      ) : null}
                      {r.seed_data ? (
                        <span className="shrink-0">
                          <Badge variant="seed">Seed</Badge>
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-0 align-middle text-right">
                    <span className="num tabular-nums text-[13px] text-ink">
                      {formatUSD(r.commitment_amount_usd)}
                    </span>
                  </td>
                  <td className="px-4 py-0 align-middle text-right">
                    <span className="num tabular-nums text-[11.5px] text-ink-muted">
                      {daysAgo(r.created_at)}
                    </span>
                  </td>
                  <td className="px-2 py-0 align-middle text-right">
                    <AuditTrailTrigger
                      documentId={r.document_id}
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
