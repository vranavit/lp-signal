"use client";

import * as React from "react";
import { MathModal, MathModalTrigger } from "./math-modal";
import { formatDate, formatUSD } from "@/lib/utils";

export function PensionHeroUnfunded({
  planName,
  total,
  perClass,
  asOfDate,
  aumUsd,
  withActualsCount,
  targetOnlyCount,
}: {
  planName: string;
  total: number;
  perClass: Array<{
    asset_class: string;
    unfunded_usd: number;
    hasActuals?: boolean;
  }>;
  asOfDate: string | null;
  aumUsd: number | null;
  withActualsCount?: number;
  targetOnlyCount?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const fyLabel = asOfDate ? `FY ${asOfDate.slice(0, 4)}` : null;
  const actualsRows = perClass.filter((c) => c.hasActuals !== false);
  const targetOnlyRows = perClass.filter((c) => c.hasActuals === false);
  return (
    <>
      <MathModalTrigger
        onClick={() => setOpen(true)}
        ariaLabel={`How ${formatUSD(total)} unfunded budget is calculated`}
      >
        <span className="num tabular-nums text-[32px] font-semibold text-ink leading-none">
          {formatUSD(total)}
        </span>
      </MathModalTrigger>
      {open ? (
        <MathModal
          title={`${planName} — unfunded private-markets budget`}
          total={total}
          totalLabel="Unfunded PE/Infra/Credit/RE/VC"
          formula="Σ max(0, target% − actual%) × plan AUM, across private-markets asset classes"
          rows={[
            ...actualsRows.map((c) => ({
              label: c.asset_class,
              value: c.unfunded_usd,
            })),
            ...(targetOnlyRows.length > 0
              ? [
                  {
                    label: `— ${targetOnlyRows.length} target-only row${targetOnlyRows.length === 1 ? "" : "s"} (excluded from gap)`,
                    value: "—",
                    hint: targetOnlyRows
                      .map((c) => c.asset_class)
                      .join(", "),
                  },
                ]
              : []),
            ...(typeof withActualsCount === "number"
              ? [
                  {
                    label: "Rows with actuals",
                    value: String(withActualsCount),
                  },
                ]
              : []),
            ...(typeof targetOnlyCount === "number" && targetOnlyCount > 0
              ? [
                  {
                    label: "Rows target-only (excluded)",
                    value: String(targetOnlyCount),
                  },
                ]
              : []),
          ]}
          lastRefreshed={
            fyLabel
              ? `${fyLabel} (snapshot as of ${formatDate(asOfDate!)})`
              : null
          }
          footnote={
            <>
              Based on the most recent available CAFR
              {fyLabel ? ` (fiscal year ${fyLabel.slice(3)})` : ""}
              {aumUsd ? `, plan AUM ${formatUSD(aumUsd)}` : ""}. Pensions
              typically publish CAFRs 6–12 months after fiscal year-end; new
              CAFRs are ingested within 7 days of public release. Gaps are
              capped at zero — overweight positions contribute nothing to the
              deployable budget.
              {targetOnlyCount && targetOnlyCount > 0 ? (
                <>
                  {" "}
                  <strong>{targetOnlyCount}</strong> private-markets row
                  {targetOnlyCount === 1 ? " has" : "s have"} a policy target
                  but no current actual in the source CAFR; those rows
                  contribute <span className="num tabular-nums">$0</span> to
                  this total and the true unfunded budget may be higher. Fund
                  fact sheet ingestion is on the Phase 4 roadmap.
                </>
              ) : null}
            </>
          }
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
