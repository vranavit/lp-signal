import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatUSD } from "@/lib/utils";

export const dynamic = "force-dynamic";

function priorityTone(score: number): "hi" | "mid" | "lo" {
  if (score >= 75) return "hi";
  if (score >= 50) return "mid";
  return "lo";
}

export default async function SignalDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("signals")
    .select(
      "id, signal_type, confidence, priority_score, asset_class, summary, fields, source_page, source_quote, commitment_amount_usd, seed_data, created_at, plan:plans!inner(id, name, country, aum_usd), document:documents(id, source_url, meeting_date)",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (error) {
    return (
      <div className="card-surface p-4 text-[13px] text-ink-muted">
        Failed to load signal: {error.message}
      </div>
    );
  }
  if (!data) notFound();

  const r = data as unknown as {
    id: string;
    signal_type: 1 | 2 | 3;
    confidence: number;
    priority_score: number;
    asset_class: string | null;
    summary: string;
    fields: Record<string, unknown>;
    source_page: number | null;
    source_quote: string | null;
    commitment_amount_usd: number | null;
    seed_data: boolean;
    created_at: string;
    plan: { id: string; name: string; country: string; aum_usd: number | null };
    document: { id: string; source_url: string; meeting_date: string | null } | null;
  };

  const tone = priorityTone(r.priority_score);

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <Link
          href="/signals"
          className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted hover:text-ink transition-colors duration-150"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Back to signals
        </Link>
        <h1 className="mt-2 text-[17px] font-semibold tracking-tightish text-ink leading-snug">
          {r.summary}
        </h1>
        <div className="mt-2 flex items-center gap-1.5">
          <Badge
            variant={
              r.signal_type === 1 ? "t1" : r.signal_type === 2 ? "t2" : "t3"
            }
          >
            {r.signal_type === 1
              ? "T1 Commitment"
              : r.signal_type === 2
              ? "T2 Target Δ"
              : "T3 Pacing"}
          </Badge>
          <Badge variant={tone}>
            <span className="num tabular-nums">Score {r.priority_score}</span>
          </Badge>
          {r.seed_data ? <Badge variant="seed">Seed</Badge> : null}
        </div>
      </div>

      <div className="card-surface overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-4">
          <Cell label="Plan" value={r.plan.name} />
          <Cell label="Country" value={r.plan.country} mono />
          <Cell label="Asset class" value={r.asset_class ?? "—"} />
          <Cell label="Priority score" value={String(r.priority_score)} mono />
          <Cell label="Commitment" value={formatUSD(r.commitment_amount_usd)} mono />
          <Cell label="Plan AUM" value={formatUSD(r.plan.aum_usd)} mono />
          <Cell label="Confidence" value={r.confidence.toFixed(2)} mono />
          <Cell label="Captured" value={formatDate(r.created_at)} mono />
        </div>
      </div>

      {r.source_quote ? (
        <section className="card-surface p-4">
          <div className="text-[12px] text-ink-faint">Source quote</div>
          <blockquote className="mt-2 text-[13px] text-ink leading-relaxed border-l-2 border-line-strong pl-3">
            &ldquo;{r.source_quote}&rdquo;
          </blockquote>
          <div className="mt-3 flex items-center gap-4">
            {r.source_page ? (
              <div className="num text-[11.5px] text-ink-muted">
                Page {r.source_page}
              </div>
            ) : null}
            {r.document?.source_url ? (
              <a
                href={r.document.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:text-accent-hi transition-colors duration-150"
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                Open source PDF
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="card-surface p-4">
        <div className="text-[12px] text-ink-faint">Extracted fields</div>
        <pre className="mt-2 num text-[12px] text-ink overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(r.fields, null, 2)}
        </pre>
      </section>
    </div>
  );
}

function Cell({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="px-4 py-3 border-t border-l border-line first:border-l-0 md:[&:nth-child(-n+4)]:border-t-0 [&:nth-child(-n+2)]:border-t-0 md:[&:nth-child(4n+1)]:border-l-0 [&:nth-child(2n+1)]:border-l-0 md:[&:nth-child(2n+1):not(:nth-child(4n+1))]:border-l">
      <div className="text-[11.5px] text-ink-faint">{label}</div>
      <div
        className={
          "mt-1 text-[13px] text-ink " + (mono ? "num tabular-nums" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}
