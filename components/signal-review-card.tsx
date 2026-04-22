"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  formatConfidence,
  formatPriorityScore,
  formatUSD,
  isAmountKey,
} from "@/lib/utils";
import {
  approveSignal,
  editAndApproveSignal,
  rejectSignal,
} from "@/app/(dashboard)/signals/review/actions";

export type ReviewSignal = {
  id: string;
  signal_type: 1 | 2 | 3;
  confidence: number;
  priority_score: number;
  asset_class: string | null;
  summary: string;
  fields: Record<string, unknown>;
  source_page: number | null;
  source_quote: string | null;
  commitment_amount_usd: number | null;
  created_at: string;
  plan: { id: string; name: string; country: string };
  document: {
    id: string;
    source_url: string;
    meeting_date: string | null;
  } | null;
};

function tone(score: number): "hi" | "mid" | "lo" {
  if (score >= 75) return "hi";
  if (score >= 50) return "mid";
  return "lo";
}

function typeBadge(t: 1 | 2 | 3): "t1" | "t2" | "t3" {
  return t === 1 ? "t1" : t === 2 ? "t2" : "t3";
}

export function SignalReviewCard({ signal }: { signal: ReviewSignal }) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <article className="card-surface overflow-hidden">
      <header className="px-4 py-3 border-b border-line flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-ink-faint">{signal.plan.name}</div>
          <div className="mt-1 text-[14px] font-semibold text-ink tracking-tightish leading-snug">
            {signal.summary}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant={typeBadge(signal.signal_type)}>
              T{signal.signal_type}
            </Badge>
            <Badge variant={tone(signal.priority_score)}>
              <span className="num tabular-nums">
                Score {formatPriorityScore(signal.priority_score)}
              </span>
            </Badge>
            <Badge>
              <span className="num tabular-nums">
                Conf {formatConfidence(signal.confidence)}
              </span>
            </Badge>
            {signal.asset_class ? <Badge>{signal.asset_class}</Badge> : null}
            {signal.commitment_amount_usd != null ? (
              <span className="num tabular-nums text-[12px] text-ink">
                {formatUSD(signal.commitment_amount_usd)}
              </span>
            ) : null}
          </div>
        </div>
        {mode === "view" ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <ActionButton
              variant="approve"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const fd = new FormData();
                  fd.set("id", signal.id);
                  await approveSignal(fd);
                })
              }
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              Approve
            </ActionButton>
            <ActionButton
              variant="neutral"
              disabled={pending}
              onClick={() => setMode("edit")}
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
              Edit
            </ActionButton>
            <ActionButton
              variant="reject"
              disabled={pending}
              onClick={() => {
                if (!confirm("Delete this signal? This cannot be undone."))
                  return;
                run(async () => {
                  const fd = new FormData();
                  fd.set("id", signal.id);
                  await rejectSignal(fd);
                });
              }}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              Reject
            </ActionButton>
          </div>
        ) : null}
      </header>

      {mode === "view" ? (
        <div className="divide-y divide-line">
          <Grid>
            {Object.entries(signal.fields).map(([k, v]) => (
              <Field key={k} label={k} value={v} />
            ))}
            <Field
              label="source_page"
              value={signal.source_page ?? "—"}
              mono
            />
            {signal.document?.meeting_date ? (
              <Field
                label="meeting_date"
                value={signal.document.meeting_date}
                mono
              />
            ) : null}
          </Grid>
          {signal.source_quote ? (
            <div className="px-4 py-3">
              <div className="text-[11px] text-ink-faint mb-1.5">
                Source quote
              </div>
              <blockquote className="text-[12.5px] text-ink leading-relaxed border-l-2 border-line-strong pl-3">
                &ldquo;{signal.source_quote}&rdquo;
              </blockquote>
            </div>
          ) : null}
          {signal.document?.source_url ? (
            <div className="px-4 py-2.5">
              <a
                href={signal.document.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:text-accent-hi transition-colors duration-150"
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                Open source PDF
              </a>
            </div>
          ) : null}
        </div>
      ) : (
        <form
          action={(fd) =>
            run(async () => {
              await editAndApproveSignal(fd);
            })
          }
          className="p-4 space-y-3"
        >
          <input type="hidden" name="id" value={signal.id} />
          <LabeledTextarea
            label="Summary"
            name="summary"
            defaultValue={signal.summary}
            rows={2}
          />
          <LabeledTextarea
            label="Source quote"
            name="source_quote"
            defaultValue={signal.source_quote ?? ""}
            rows={2}
          />
          <LabeledTextarea
            label="Fields (JSON)"
            name="fields"
            defaultValue={JSON.stringify(signal.fields, null, 2)}
            rows={10}
            mono
          />
          <div className="flex items-center justify-end gap-1.5 pt-1">
            <ActionButton
              type="button"
              variant="neutral"
              disabled={pending}
              onClick={() => setMode("view")}
            >
              Cancel
            </ActionButton>
            <ActionButton type="submit" variant="approve" disabled={pending}>
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              Save & approve
            </ActionButton>
          </div>
        </form>
      )}

      {error ? (
        <div className="px-4 py-2 border-t border-line text-[12px] text-red-500">
          {error}
        </div>
      ) : null}
    </article>
  );
}

function ActionButton({
  children,
  variant,
  disabled,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  variant: "approve" | "reject" | "neutral";
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  const cls =
    variant === "approve"
      ? "bg-accent text-white border-accent hover:bg-accent-hi"
      : variant === "reject"
      ? "bg-transparent text-ink-muted border-line hover:text-red-500 hover:border-red-500/60"
      : "bg-bg text-ink-muted border-line hover:text-ink hover:border-line-strong";
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 text-[12px] font-medium border rounded-sm transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-wait ${cls}`}
    >
      {children}
    </button>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-2 grid grid-cols-2 gap-x-6 gap-y-1">{children}</div>;
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: unknown;
  mono?: boolean;
}) {
  const isAmount = isAmountKey(label) && typeof value === "number";
  const display =
    value === null || value === undefined
      ? "—"
      : isAmount
      ? formatUSD(value as number)
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  const useMono = mono || isAmount || typeof value === "number";
  return (
    <div className="py-1.5 grid grid-cols-[110px_1fr] gap-3 items-baseline">
      <div className="text-[11px] text-ink-faint truncate">{label}</div>
      <div
        className={
          (useMono ? "num tabular-nums " : "") +
          "text-[12.5px] text-ink break-words"
        }
      >
        {display}
      </div>
    </div>
  );
}

function LabeledTextarea({
  label,
  name,
  defaultValue,
  rows,
  mono = false,
}: {
  label: string;
  name: string;
  defaultValue: string;
  rows: number;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <div className="text-[11px] text-ink-faint mb-1">{label}</div>
      <textarea
        name={name}
        defaultValue={defaultValue}
        rows={rows}
        className={
          "w-full px-2.5 py-1.5 text-[13px] bg-bg border border-line rounded-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-y " +
          (mono ? "num" : "")
        }
      />
    </label>
  );
}
