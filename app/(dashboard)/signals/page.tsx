import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SignalsWorkspace,
  type SignalWithDoc,
} from "@/components/signals-workspace";

export const dynamic = "force-dynamic";

export default async function SignalsPage() {
  const supabase = createSupabaseServerClient();

  // Real signals only become visible once an operator approves them on
  // /signals/review (validated_at IS NOT NULL). Seeds stay visible always.
  const { data, error } = await supabase
    .from("signals")
    .select(
      "id, plan_id, document_id, signal_type, confidence, priority_score, asset_class, summary, fields, source_page, source_quote, commitment_amount_usd, seed_data, created_at, plan:plans!inner(id, name, country, aum_usd), document:documents(id, source_url, meeting_date)",
    )
    .or("validated_at.not.is.null,seed_data.eq.true")
    .order("priority_score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as SignalWithDoc[];

  const { count: pendingCount } = await supabase
    .from("signals")
    .select("id", { count: "exact", head: true })
    .is("validated_at", null)
    .eq("seed_data", false);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-[15px] font-semibold tracking-tightish text-ink leading-tight">
          Signals
        </h1>
        <div className="flex items-center gap-3">
          {pendingCount && pendingCount > 0 ? (
            <Link
              href="/signals/review"
              className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[12px] text-accent hover:text-accent-hi border border-accent/30 hover:border-accent rounded-sm bg-accent/5 transition-colors duration-150 cursor-pointer"
            >
              <span className="num tabular-nums font-medium">
                {pendingCount}
              </span>
              <span>pending review</span>
              <span aria-hidden>→</span>
            </Link>
          ) : null}
          <span className="num tabular-nums text-[12px] text-ink-muted">
            {rows.length} visible
          </span>
        </div>
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
