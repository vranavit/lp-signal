import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import {
  SignalReviewCard,
  type ReviewSignal,
} from "@/components/signal-review-card";
import { formatConfidence, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RejectedRow = {
  id: string;
  signal_type: 1 | 2 | 3;
  confidence: number;
  asset_class: string | null;
  summary: string;
  source_page: number | null;
  source_quote: string;
  rejection_reason: string;
  prompt_version: string | null;
  created_at: string;
  plan: { id: string; name: string } | null;
  document: { source_url: string | null } | null;
};

const REJECTED_WINDOW_DAYS = 7;

export default async function ReviewPage() {
  const supabase = createSupabaseServerClient();

  const { data: preliminaryData, error: preliminaryError } = await supabase
    .from("signals")
    .select(
      "id, signal_type, confidence, priority_score, asset_class, summary, fields, source_page, source_quote, commitment_amount_usd, created_at, plan:plans!inner(id, name, country), document:documents(id, source_url, meeting_date)",
    )
    .eq("preliminary", true)
    .eq("seed_data", false)
    .order("priority_score", { ascending: false })
    .order("confidence", { ascending: false });

  const preliminaryRows = (preliminaryData ?? []) as unknown as ReviewSignal[];

  // rejected_signals is locked to service-role reads only (RLS enable + no
  // policies). Use the admin client for this query — the dashboard layout
  // already gated auth upstream.
  const admin = createSupabaseAdminClient();
  const rejectedCutoff = new Date(
    Date.now() - REJECTED_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  const { data: rejectedData, error: rejectedError } = await admin
    .from("rejected_signals")
    .select(
      "id, signal_type, confidence, asset_class, summary, source_page, source_quote, rejection_reason, prompt_version, created_at, plan:plans(id, name), document:documents(source_url)",
    )
    .gte("created_at", rejectedCutoff)
    .order("created_at", { ascending: false })
    .limit(100);

  const rejectedRows = (rejectedData ?? []) as unknown as RejectedRow[];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link
          href="/signals"
          className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted hover:text-ink transition-colors duration-150"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Back to signals
        </Link>
      </div>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3 border-b border-line pb-3">
          <div>
            <h1 className="text-[15px] font-semibold tracking-tightish text-ink leading-tight">
              Preliminary signals
            </h1>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              Auto-published with a caveat (mid-confidence or low-priority).
              Confirm to clear the flag, reject to send to the rejection log.
            </p>
          </div>
          <div className="num tabular-nums text-[13px] text-ink font-medium">
            {preliminaryRows.length} preliminary
          </div>
        </div>

        {preliminaryError ? (
          <div className="card-surface p-4 text-[13px] text-ink-muted">
            Failed to load preliminary signals: {preliminaryError.message}
          </div>
        ) : preliminaryRows.length === 0 ? (
          <div className="card-surface p-10 text-center">
            <div className="text-[13px] text-ink-muted">
              Nothing preliminary right now. New mid-confidence signals land
              here automatically.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {preliminaryRows.map((r) => (
              <SignalReviewCard key={r.id} signal={r} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3 border-b border-line pb-3">
          <div>
            <h2 className="text-[14px] font-semibold tracking-tightish text-ink leading-tight">
              Recently rejected
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              Classifier output below 0.70 confidence from the last{" "}
              {REJECTED_WINDOW_DAYS} days. Read-only — used for prompt tuning.
            </p>
          </div>
          <div className="num tabular-nums text-[13px] text-ink-muted">
            {rejectedRows.length} rows
          </div>
        </div>

        {rejectedError ? (
          <div className="card-surface p-4 text-[13px] text-ink-muted">
            Failed to load rejections: {rejectedError.message}
          </div>
        ) : rejectedRows.length === 0 ? (
          <div className="card-surface p-6 text-center">
            <div className="text-[13px] text-ink-muted">
              No rejected signals in the last {REJECTED_WINDOW_DAYS} days.
            </div>
          </div>
        ) : (
          <div className="card-surface divide-y divide-line">
            {rejectedRows.map((r) => (
              <RejectedRowItem key={r.id} row={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RejectedRowItem({ row }: { row: RejectedRow }) {
  const typeLabel =
    row.signal_type === 1 ? "T1" : row.signal_type === 2 ? "T2" : "T3";
  const typeVariant: "t1" | "t2" | "t3" =
    row.signal_type === 1 ? "t1" : row.signal_type === 2 ? "t2" : "t3";

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-ink-faint">
            {row.plan?.name ?? "—"} · {formatDate(row.created_at)}
          </div>
          <div className="mt-0.5 text-[13px] text-ink leading-snug">
            {row.summary}
          </div>
          {row.source_quote ? (
            <blockquote className="mt-1.5 text-[12px] text-ink-muted leading-relaxed border-l-2 border-line-strong pl-2.5">
              &ldquo;{row.source_quote}&rdquo;
            </blockquote>
          ) : null}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            <Badge variant={typeVariant}>{typeLabel}</Badge>
            {row.asset_class ? <Badge>{row.asset_class}</Badge> : null}
          </div>
          <div className="num tabular-nums text-[11px] text-ink-faint">
            conf {formatConfidence(row.confidence)}
          </div>
          <div className="text-[10.5px] text-ink-faint">
            {row.rejection_reason}
          </div>
          {row.document?.source_url ? (
            <a
              href={row.document.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent-hi transition-colors duration-150"
            >
              <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
              source
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
