import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatUSD } from "@/lib/utils";

export const dynamic = "force-dynamic";

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
      <div className="panel p-4 text-sm text-ink-muted">
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

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/signals"
          className="text-[11px] uppercase tracking-widest text-ink-faint mono hover:text-ink"
        >
          ← Signals
        </Link>
        <h1 className="mt-2 text-lg font-semibold tracking-tightish text-ink">
          {r.summary}
        </h1>
        <div className="mt-2 flex items-center gap-3">
          <Badge variant={r.signal_type === 1 ? "t1" : r.signal_type === 2 ? "t2" : "t3"}>
            {r.signal_type === 1 ? "T1 · Commitment" : r.signal_type === 2 ? "T2 · Target Δ" : "T3 · Pacing"}
          </Badge>
          {r.seed_data ? <Badge variant="seed">Seed</Badge> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line border border-line">
        <Cell label="Plan" value={r.plan.name} mono={false} />
        <Cell label="Country" value={r.plan.country} />
        <Cell label="Asset class" value={r.asset_class ?? "—"} />
        <Cell label="Priority score" value={String(r.priority_score)} />
        <Cell label="Commitment" value={formatUSD(r.commitment_amount_usd)} />
        <Cell label="Plan AUM" value={formatUSD(r.plan.aum_usd)} />
        <Cell label="Confidence" value={r.confidence.toFixed(2)} />
        <Cell label="Captured" value={formatDate(r.created_at)} />
      </div>

      {r.source_quote ? (
        <section className="panel p-4">
          <div className="text-[11px] uppercase tracking-widest text-ink-faint mono">
            Source quote
          </div>
          <blockquote className="mt-2 text-sm text-ink border-l-2 border-line-strong pl-3">
            &ldquo;{r.source_quote}&rdquo;
          </blockquote>
          {r.source_page ? (
            <div className="mt-2 text-[11px] mono text-ink-muted">
              Page {r.source_page}
            </div>
          ) : null}
          {r.document?.source_url ? (
            <a
              href={r.document.source_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs text-accent hover:underline"
            >
              Open source document ↗
            </a>
          ) : null}
        </section>
      ) : null}

      <section className="panel p-4">
        <div className="text-[11px] uppercase tracking-widest text-ink-faint mono">
          Extracted fields
        </div>
        <pre className="mt-2 mono text-[12px] text-ink overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(r.fields, null, 2)}
        </pre>
      </section>
    </div>
  );
}

function Cell({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-bg-panel px-3 py-3">
      <div className="text-[10px] uppercase tracking-widest text-ink-faint mono">
        {label}
      </div>
      <div className={"mt-1 text-sm text-ink " + (mono ? "mono tabular-nums" : "")}>
        {value}
      </div>
    </div>
  );
}
