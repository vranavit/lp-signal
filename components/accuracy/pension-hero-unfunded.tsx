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
}: {
  planName: string;
  total: number;
  perClass: Array<{ asset_class: string; unfunded_usd: number }>;
  asOfDate: string | null;
  aumUsd: number | null;
}) {
  const [open, setOpen] = React.useState(false);
  const fyLabel = asOfDate ? `FY ${asOfDate.slice(0, 4)}` : null;
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
          rows={perClass.map((c) => ({
            label: c.asset_class,
            value: c.unfunded_usd,
          }))}
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
            </>
          }
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
