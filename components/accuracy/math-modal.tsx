"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Calculator, X } from "lucide-react";
import { formatUSD } from "@/lib/utils";

export type MathModalRow = {
  label: string;
  value: number | string;
  hint?: string;
};

export type MathModalProps = {
  title: string;
  total?: number | string;
  totalLabel?: string;
  formula?: string;
  rows?: MathModalRow[];
  lastRefreshed?: string | null;
  footnote?: React.ReactNode;
  onClose: () => void;
};

/**
 * "How we calculated this" modal for aggregate numbers. Click a
 * MathModalTrigger → shows the formula, the per-row composition, the
 * last-refreshed date, and a footnote explaining methodology.
 */
export function MathModal(props: MathModalProps) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props]);

  if (typeof window === "undefined") return null;

  const total =
    typeof props.total === "number" ? formatUSD(props.total) : props.total;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={props.onClose}
    >
      <div
        className="card-surface w-full max-w-lg shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-line flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Calculator
              className="h-4 w-4 text-ink-faint"
              strokeWidth={1.75}
            />
            <div className="text-[13.5px] font-semibold text-ink">
              {props.title}
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="h-7 w-7 inline-flex items-center justify-center text-ink-faint hover:text-ink border border-transparent hover:border-line rounded-sm cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {props.formula ? (
            <div className="rounded-sm border border-line bg-bg-panel px-3 py-2.5">
              <div className="text-[10.5px] uppercase text-ink-faint mb-1 tracking-wide">
                Formula
              </div>
              <div className="text-[12.5px] text-ink font-mono leading-snug">
                {props.formula}
              </div>
            </div>
          ) : null}

          {props.rows && props.rows.length > 0 ? (
            <div>
              <div className="text-[10.5px] uppercase text-ink-faint mb-1.5 tracking-wide">
                Composition
              </div>
              <div className="border border-line rounded-sm divide-y divide-line overflow-hidden">
                {props.rows.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-1.5 text-[12.5px]"
                  >
                    <div className="min-w-0">
                      <div className="text-ink truncate">{r.label}</div>
                      {r.hint ? (
                        <div className="text-[11px] text-ink-faint truncate">
                          {r.hint}
                        </div>
                      ) : null}
                    </div>
                    <div className="font-mono tabular-nums text-ink shrink-0 pl-3">
                      {typeof r.value === "number" ? formatUSD(r.value) : r.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {total != null ? (
            <div className="flex items-center justify-between px-3 py-2 border border-line rounded-sm bg-bg-subtle">
              <div className="text-[11.5px] uppercase text-ink-faint tracking-wide">
                {props.totalLabel ?? "Total"}
              </div>
              <div className="font-mono tabular-nums text-[15px] font-semibold text-ink">
                {total}
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between text-[11px] text-ink-faint pt-1">
            <span>
              {props.lastRefreshed
                ? `Last refreshed: ${props.lastRefreshed}`
                : "Refreshes on each data ingest."}
            </span>
          </div>

          {props.footnote ? (
            <div className="text-[11.5px] text-ink-muted leading-relaxed border-t border-line pt-3">
              {props.footnote}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Thin wrapper that renders children as a clickable target styled to imply
 * an affordance (underline on hover, cursor help).
 */
export function MathModalTrigger({
  children,
  className = "",
  onClick,
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? "See calculation"}
      className={
        "inline-flex items-baseline gap-1 cursor-help hover:text-accent-hi focus:outline-none focus:ring-2 focus:ring-accent/40 rounded-sm " +
        className
      }
    >
      {children}
      <Calculator
        className="h-3 w-3 text-ink-faint opacity-60"
        strokeWidth={1.75}
        aria-hidden
      />
    </button>
  );
}
