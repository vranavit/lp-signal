import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SignalReviewCard,
  type ReviewSignal,
} from "@/components/signal-review-card";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("signals")
    .select(
      "id, signal_type, confidence, priority_score, asset_class, summary, fields, source_page, source_quote, commitment_amount_usd, created_at, plan:plans!inner(id, name, country), document:documents(id, source_url, meeting_date)",
    )
    .is("validated_at", null)
    .eq("seed_data", false)
    .order("confidence", { ascending: false })
    .order("priority_score", { ascending: false });

  const rows = (data ?? []) as unknown as ReviewSignal[];

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <Link
          href="/signals"
          className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted hover:text-ink transition-colors duration-150"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Back to signals
        </Link>
      </div>

      <div className="flex items-end justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tightish text-ink leading-tight">
            Signals pending review
          </h1>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            Approve, reject, or edit each signal before it appears in the main
            dashboard. Seeds are already visible.
          </p>
        </div>
        <div className="num tabular-nums text-[13px] text-ink font-medium">
          {rows.length} pending
        </div>
      </div>

      {error ? (
        <div className="card-surface p-4 text-[13px] text-ink-muted">
          Failed to load: {error.message}
        </div>
      ) : rows.length === 0 ? (
        <div className="card-surface p-10 text-center">
          <div className="text-[13px] text-ink-muted">
            Nothing pending review. New signals will show up here after the
            classifier runs.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <SignalReviewCard key={r.id} signal={r} />
          ))}
        </div>
      )}
    </div>
  );
}
