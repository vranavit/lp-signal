import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SignalTable } from "@/components/signal-table";
import type { SignalWithPlan } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SignalsPage() {
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from("signals")
    .select(
      "id, plan_id, document_id, signal_type, confidence, priority_score, asset_class, summary, fields, source_page, source_quote, commitment_amount_usd, seed_data, created_at, plan:plans!inner(id, name, country, aum_usd)",
    )
    .order("priority_score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as SignalWithPlan[];

  const tierCounts = rows.reduce(
    (acc, r) => {
      acc[r.signal_type] = (acc[r.signal_type] ?? 0) + 1;
      return acc;
    },
    {} as Record<number, number>,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-ink-faint mono">
            Dashboard / Signals
          </div>
          <h1 className="mt-1 text-lg font-semibold tracking-tightish text-ink">
            Pension allocation signals
          </h1>
        </div>
        <div className="flex items-center gap-6 mono text-[11px] text-ink-muted">
          <Stat label="Total" value={rows.length} />
          <Stat label="T1" value={tierCounts[1] ?? 0} />
          <Stat label="T2" value={tierCounts[2] ?? 0} />
          <Stat label="T3" value={tierCounts[3] ?? 0} />
        </div>
      </div>

      {error ? (
        <div className="panel p-4 text-sm text-ink-muted">
          Failed to load signals: {error.message}
        </div>
      ) : (
        <SignalTable rows={rows} />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="uppercase tracking-widest text-ink-faint">{label}</span>
      <span className="text-ink tabular-nums">{value}</span>
    </div>
  );
}
