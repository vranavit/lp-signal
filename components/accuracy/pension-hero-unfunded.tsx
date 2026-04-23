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
          lastRefreshed={asOfDate ? formatDate(asOfDate) : null}
          footnote={
            <>
              Based on the most recent CAFR snapshot for this plan
              {aumUsd
                ? ` (plan AUM ${formatUSD(aumUsd)})`
                : ""}
              . Gaps are capped at zero — overweight positions contribute nothing
              to the deployable budget.
            </>
          }
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
