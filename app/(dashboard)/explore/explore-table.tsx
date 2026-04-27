"use client";

import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge } from "@/components/accuracy/confidence-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatUSD } from "@/lib/utils";
import {
  approvalTypeAbbr,
  approvalTypeFull,
  fieldStr,
  type ExploreSignal,
} from "./explore-types";
import type { SortColumn, SortDir } from "./use-explore-filter-state";

type EmptyHint = { droppedFilter: string; matchCount: number } | null;

export function ExploreTable({
  rows,
  totalRowCount,
  sortColumn,
  sortDir,
  page,
  pageCount,
  pageSize,
  expandedId,
  emptyHint,
  onChangeSort,
  onChangePage,
  onToggleExpand,
  onResetFilters,
}: {
  rows: ExploreSignal[];
  totalRowCount: number;
  sortColumn: SortColumn;
  sortDir: SortDir;
  page: number;
  pageCount: number;
  pageSize: number;
  expandedId: string | null;
  emptyHint: EmptyHint;
  onChangeSort: (col: SortColumn) => void;
  onChangePage: (p: number) => void;
  onToggleExpand: (id: string) => void;
  onResetFilters: () => void;
}) {
  if (totalRowCount === 0) {
    return (
      <EmptyState
        title="No commitments match these filters"
        description={
          emptyHint
            ? `${emptyHint.matchCount.toLocaleString()} signals would match if you remove the ${emptyHint.droppedFilter} filter.`
            : "Try widening the time window or clearing search."
        }
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onResetFilters}
          >
            Clear all filters
          </Button>
        }
      />
    );
  }

  const startIdx = (page - 1) * pageSize + 1;
  const endIdx = startIdx + rows.length - 1;

  return (
    <div className="space-y-2">
      <div className="card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-ink-faint">
                <SortTh col="plan" label="Plan" sort={sortColumn} dir={sortDir} onClick={onChangeSort} />
                <SortTh col="date" label="Approval Date" sort={sortColumn} dir={sortDir} onClick={onChangeSort} />
                <SortTh col="gp" label="GP" sort={sortColumn} dir={sortDir} onClick={onChangeSort} />
                <SortTh col="fund" label="Fund" sort={sortColumn} dir={sortDir} onClick={onChangeSort} />
                <SortTh col="amount" label="Amount" sort={sortColumn} dir={sortDir} onClick={onChangeSort} alignRight />
                <SortTh col="asset" label="Asset" sort={sortColumn} dir={sortDir} onClick={onChangeSort} />
                <SortTh col="type" label="Type" sort={sortColumn} dir={sortDir} onClick={onChangeSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const expanded = expandedId === r.id;
                const gp = fieldStr(r, "gp");
                const fund = fieldStr(r, "fund_name");
                const ac = fieldStr(r, "asset_class") || "—";
                const ad = fieldStr(r, "approval_date") || "—";
                const tk = fieldStr(r, "approval_type");
                return (
                  <RowGroup
                    key={r.id}
                    expanded={expanded}
                    row={r}
                    gp={gp}
                    fund={fund}
                    ac={ac}
                    ad={ad}
                    typeKey={tk}
                    onToggleExpand={onToggleExpand}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11.5px] text-ink-faint">
        <div>
          Showing {startIdx.toLocaleString()}–{endIdx.toLocaleString()} of {totalRowCount.toLocaleString()}
        </div>
        <div className="inline-flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChangePage(Math.max(1, page - 1))}
            disabled={page <= 1}
          >
            ‹ Prev
          </Button>
          <span className="num tabular-nums text-ink-muted">
            Page {page} of {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChangePage(Math.min(pageCount, page + 1))}
            disabled={page >= pageCount}
          >
            Next ›
          </Button>
        </div>
      </div>
    </div>
  );
}

function RowGroup({
  expanded,
  row,
  gp,
  fund,
  ac,
  ad,
  typeKey,
  onToggleExpand,
}: {
  expanded: boolean;
  row: ExploreSignal;
  gp: string;
  fund: string;
  ac: string;
  ad: string;
  typeKey: string;
  onToggleExpand: (id: string) => void;
}) {
  return (
    <>
      <tr
        onClick={() => onToggleExpand(row.id)}
        className={
          "h-10 border-b border-line cursor-pointer transition-colors duration-150 " +
          (expanded
            ? "bg-accent/5 outline outline-1 -outline-offset-1 outline-accent/40"
            : "odd:bg-black/[0.015] dark:odd:bg-white/[0.02] hover:bg-bg-hover")
        }
      >
        <td className="px-3 align-middle">
          <div className="flex items-center gap-1.5">
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-accent" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-3 w-3 text-ink-faint" strokeWidth={2} />
            )}
            <span className="text-[12.5px] text-ink truncate max-w-[180px]">
              {row.plan?.name ?? "—"}
            </span>
          </div>
        </td>
        <td className="px-3 align-middle">
          <span className="num tabular-nums text-[12.5px] text-ink-muted">
            {ad}
          </span>
        </td>
        <td className="px-3 align-middle">
          <span className="text-[12.5px] text-ink truncate max-w-[180px] block">
            {gp || "—"}
          </span>
        </td>
        <td className="px-3 align-middle">
          <span className="text-[12px] text-ink-muted truncate max-w-[260px] block">
            {fund || "—"}
          </span>
        </td>
        <td className="px-3 align-middle text-right">
          <span className="num tabular-nums text-[12.5px] text-ink">
            {formatUSD(row.commitment_amount_usd)}
          </span>
        </td>
        <td className="px-3 align-middle">
          <span className="text-[12px] text-ink-muted">{ac}</span>
        </td>
        <td className="px-3 align-middle">
          <span className="text-[12px] text-ink-muted">
            {approvalTypeAbbr(typeKey)}
          </span>
        </td>
      </tr>
      {expanded ? (
        <tr className="bg-accent/5 border-b border-line">
          <td colSpan={7} className="px-4 py-3">
            <ExpandedDetail row={row} typeKey={typeKey} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ExpandedDetail({
  row,
  typeKey,
}: {
  row: ExploreSignal;
  typeKey: string;
}) {
  return (
    <div className="space-y-3 max-w-[920px]">
      <div>
        <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">
          Summary
        </div>
        <div className="mt-1 text-[13px] text-ink leading-relaxed">
          {row.summary}
        </div>
      </div>
      {row.source_quote ? (
        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">
            Source quote (verbatim
            {row.source_page ? `, p. ${row.source_page}` : ""})
          </div>
          <div className="mt-1 text-[12.5px] text-ink-muted italic leading-relaxed border-l-2 border-line pl-3">
            “{row.source_quote}”
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="inline-flex items-center gap-2">
          <span className="text-[10.5px] uppercase tracking-wide text-ink-faint">
            Confidence
          </span>
          <ConfidenceBadge
            confidence={row.confidence}
            priority={row.priority_score}
            preliminary={row.preliminary}
          />
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="text-[10.5px] uppercase tracking-wide text-ink-faint">
            Approval type
          </span>
          <span className="text-[12px] text-ink-muted">
            {approvalTypeFull(typeKey)}
          </span>
        </div>
        {row.document?.source_url ? (
          <a
            href={row.document.source_url}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] text-accent-hi hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
          >
            ↗ Open source document
          </a>
        ) : null}
      </div>
    </div>
  );
}

function SortTh({
  col,
  label,
  sort,
  dir,
  onClick,
  alignRight,
}: {
  col: SortColumn;
  label: string;
  sort: SortColumn;
  dir: SortDir;
  onClick: (col: SortColumn) => void;
  alignRight?: boolean;
}) {
  const active = sort === col;
  const Icon = dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <th
      className={
        "font-normal text-[12px] px-3 h-9 bg-bg-subtle " +
        (active ? "text-ink" : "text-ink-faint") +
        " " +
        (alignRight ? "text-right" : "text-left")
      }
    >
      <button
        type="button"
        onClick={() => onClick(col)}
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
        className={
          "inline-flex items-center gap-1 transition-colors duration-150 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg " +
          (active ? "text-ink font-medium" : "text-ink-faint hover:text-ink") +
          " " +
          (alignRight ? "ml-auto" : "")
        }
      >
        <span>{label}</span>
        {active ? (
          <Icon className="h-3 w-3 text-ink" strokeWidth={2} />
        ) : null}
      </button>
    </th>
  );
}
