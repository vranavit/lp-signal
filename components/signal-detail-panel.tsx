"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  formatConfidence,
  formatDate,
  formatPriorityScore,
  formatUSD,
} from "@/lib/utils";
import type { SignalWithDoc } from "@/components/signals-workspace";

function priorityTone(score: number): "hi" | "mid" | "lo" {
  if (score >= 75) return "hi";
  if (score >= 50) return "mid";
  return "lo";
}

function pickString(
  obj: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

export function SignalDetailPanel({ signal }: { signal: SignalWithDoc | null }) {
  if (!signal) {
    return (
      <div className="card-surface h-full min-h-[420px] flex items-center justify-center">
        <div className="text-[13px] text-ink-dim text-center px-6">
          Select a signal to view details
        </div>
      </div>
    );
  }

  const gp = pickString(signal.fields, ["gp", "manager", "firm", "sponsor"]);
  const fund = pickString(signal.fields, ["fund_name", "fund", "fund_title"]);
  const rawDate = signal.document?.meeting_date ?? signal.created_at;
  const pdfUrl = signal.document?.source_url ?? null;
  const tone = priorityTone(signal.priority_score);

  return (
    <div className="card-surface h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-line">
        <div className="text-[11px] text-ink-faint">{signal.plan.name}</div>
        <div className="mt-1 text-[14px] font-semibold text-ink tracking-tightish leading-snug">
          {signal.summary}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Badge
            variant={
              signal.signal_type === 1
                ? "t1"
                : signal.signal_type === 2
                ? "t2"
                : "t3"
            }
          >
            T{signal.signal_type}
          </Badge>
          <Badge variant={tone}>
            <span className="num tabular-nums">
              Score {formatPriorityScore(signal.priority_score)}
            </span>
          </Badge>
          {signal.preliminary ? (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-faint border border-line bg-bg-subtle px-1.5 h-[18px] rounded-sm">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-ink-dim"
              />
              preliminary
            </span>
          ) : null}
          {signal.seed_data ? <Badge variant="seed">Seed</Badge> : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <DetailField label="GP" value={gp ?? "—"} />
        <DetailField label="Fund" value={fund ?? "—"} />
        <DetailField
          label="Amount"
          value={formatUSD(signal.commitment_amount_usd)}
          mono
        />
        <DetailField label="Date" value={formatDate(rawDate)} mono />
        <DetailField label="Asset class" value={signal.asset_class ?? "—"} />
        <DetailField
          label="Confidence"
          value={formatConfidence(signal.confidence)}
          mono
        />

        {signal.source_quote ? (
          <div className="px-4 py-3 border-t border-line">
            <div className="text-[11px] text-ink-faint mb-1.5">
              Source quote
            </div>
            <blockquote className="text-[12.5px] text-ink leading-relaxed border-l-2 border-line-strong pl-3">
              &ldquo;{signal.source_quote}&rdquo;
            </blockquote>
            {signal.source_page ? (
              <div className="mt-2 num text-[11px] text-ink-muted">
                Page {signal.source_page}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="px-4 py-3 border-t border-line flex flex-col gap-2">
          {pdfUrl ? (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[12.5px] text-accent hover:text-accent-hi transition-colors duration-150"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              Open source PDF
            </a>
          ) : (
            <span className="text-[12.5px] text-ink-dim">
              No source PDF linked
            </span>
          )}
          <Link
            href={`/signals/${signal.id}`}
            className="text-[12.5px] text-accent hover:text-accent-hi transition-colors duration-150"
          >
            View full detail →
          </Link>
        </div>
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="px-4 py-2.5 border-t border-line first:border-t-0 grid grid-cols-[96px_1fr] gap-3 items-baseline">
      <div className="text-[12px] text-ink-faint">{label}</div>
      <div
        className={
          (mono ? "num tabular-nums " : "") + "text-[13px] text-ink break-words"
        }
      >
        {value}
      </div>
    </div>
  );
}
