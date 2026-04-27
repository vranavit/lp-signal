"use client";

import { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { formatUSD } from "@/lib/utils";
import {
  fieldStr,
  type ExplorePlan,
  type ExploreSignal,
} from "./explore-types";

export type SidePanelKind = "gps" | "plans";

type Aggregate = {
  key: string;
  label: string;
  count: number;
  totalUsd: number;
};

export function ExploreSidePanel({
  kind,
  rows,
  plans,
  onClose,
}: {
  kind: SidePanelKind;
  rows: ExploreSignal[];
  plans: ExplorePlan[];
  onClose: () => void;
}) {
  const planNameById = useMemo(
    () => new Map(plans.map((p) => [p.id, p.name])),
    [plans],
  );

  const aggregates = useMemo<Aggregate[]>(() => {
    const map = new Map<string, Aggregate>();
    for (const r of rows) {
      const key = kind === "gps" ? fieldStr(r, "gp").trim() : r.plan_id;
      if (!key) continue;
      const label = kind === "gps" ? key : planNameById.get(key) ?? key;
      const cur = map.get(key) ?? { key, label, count: 0, totalUsd: 0 };
      cur.count++;
      cur.totalUsd += r.commitment_amount_usd ?? 0;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.totalUsd !== a.totalUsd) return b.totalUsd - a.totalUsd;
      return a.label.localeCompare(b.label);
    });
  }, [rows, kind, planNameById]);

  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = kind === "gps" ? "Unique GPs" : "Plans covered";
  const subtitle =
    kind === "gps"
      ? "GP firms appearing in the filtered result, ranked by commitment count."
      : "Pension plans appearing in the filtered result, ranked by commitment count.";

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />
      <aside className="absolute right-0 top-0 bottom-0 w-full sm:w-[400px] bg-bg-panel border-l border-line flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div>
            <div className="text-[13px] font-semibold text-ink">{title}</div>
            <div className="text-[11px] text-ink-faint mt-0.5">{subtitle}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-bg-hover rounded-sm"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {aggregates.length === 0 ? (
            <div className="p-4 text-[12px] text-ink-faint">
              No matches in the filtered result.
            </div>
          ) : (
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sticky top-0 bg-bg-subtle border-b border-line">
                <tr className="text-ink-faint">
                  <th className="text-left font-normal px-3 h-8 text-[11.5px]">
                    Name
                  </th>
                  <th className="text-right font-normal px-3 h-8 text-[11.5px]">
                    Count
                  </th>
                  <th className="text-right font-normal px-3 h-8 text-[11.5px]">
                    Total $
                  </th>
                </tr>
              </thead>
              <tbody>
                {aggregates.map((a) => (
                  <tr
                    key={a.key}
                    className="h-9 border-b border-line last:border-b-0 odd:bg-black/[0.015] dark:odd:bg-white/[0.02]"
                  >
                    <td className="px-3 align-middle text-ink truncate max-w-[200px]">
                      {a.label}
                    </td>
                    <td className="px-3 align-middle text-right num tabular-nums text-ink">
                      {a.count}
                    </td>
                    <td className="px-3 align-middle text-right num tabular-nums text-ink-muted">
                      {formatUSD(a.totalUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="border-t border-line px-4 py-2 text-[11px] text-ink-faint flex items-center justify-between">
          <span>
            {aggregates.length.toLocaleString()}{" "}
            {kind === "gps" ? "GP" : "plan"}
            {aggregates.length === 1 ? "" : "s"} ·{" "}
            {rows.length.toLocaleString()} commitments
          </span>
          <span>Esc to close</span>
        </div>
      </aside>
    </div>
  );
}
