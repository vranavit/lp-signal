import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SignalsWorkspace,
  type SignalWithDoc,
} from "@/components/signals-workspace";

export const dynamic = "force-dynamic";

export default async function SignalsPage() {
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from("signals")
    .select(
      "id, plan_id, document_id, signal_type, confidence, priority_score, asset_class, summary, fields, source_page, source_quote, commitment_amount_usd, seed_data, created_at, plan:plans!inner(id, name, country, aum_usd), document:documents(id, source_url, meeting_date)",
    )
    .order("priority_score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as SignalWithDoc[];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <h1 className="text-[15px] font-semibold tracking-tightish text-ink leading-tight">
          Signals
        </h1>
        <span className="num tabular-nums text-[12px] text-ink-muted">
          {rows.length} total
        </span>
      </div>

      {error ? (
        <div className="card-surface p-4 text-[13px] text-ink-muted">
          Failed to load signals: {error.message}
        </div>
      ) : (
        <SignalsWorkspace rows={rows} />
      )}
    </div>
  );
}
