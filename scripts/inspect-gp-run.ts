import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function main() {
  const s = createSupabaseAdminClient();

  console.log("=== documents (gp_press_release) ===\n");
  const { data: docs } = await s
    .from("documents")
    .select(
      "id, source_url, processing_status, error_message, api_tokens_used, published_at, gp:gps(name)",
    )
    .eq("document_type", "gp_press_release")
    .order("published_at", { ascending: false });

  for (const d of (docs ?? []) as unknown as Array<{
    id: string;
    source_url: string;
    processing_status: string;
    error_message: string | null;
    api_tokens_used: number | null;
    published_at: string | null;
    gp: { name: string } | null;
  }>) {
    console.log(`  ${d.processing_status.padEnd(10)} ${d.gp?.name ?? "?"}  pub=${d.published_at?.slice(0, 10) ?? "?"}  tokens=${d.api_tokens_used ?? "-"}`);
    console.log(`    ${d.source_url}`);
    if (d.error_message) console.log(`    ERROR: ${d.error_message}`);
    console.log();
  }

  console.log("=== signals from gp_press_release docs ===\n");
  const { data: sigs } = await s
    .from("signals")
    .select(
      "id, signal_type, confidence, priority_score, asset_class, summary, fields, preliminary, validated_at, source_quote, document:documents!inner(source_url, document_type), gp:gps(name)",
    )
    .eq("document.document_type", "gp_press_release")
    .order("created_at", { ascending: false });

  for (const sig of (sigs ?? []) as unknown as Array<{
    id: string;
    signal_type: number;
    confidence: number;
    priority_score: number;
    asset_class: string | null;
    summary: string;
    fields: Record<string, unknown>;
    preliminary: boolean;
    validated_at: string | null;
    source_quote: string;
    document: { source_url: string } | null;
    gp: { name: string } | null;
  }>) {
    const tier = sig.preliminary ? "PRELIMINARY" : "ACCEPTED";
    console.log(
      `  [T${sig.signal_type}] ${tier}  conf=${sig.confidence.toFixed(2)}  priority=${sig.priority_score}  gp=${sig.gp?.name ?? "?"}`,
    );
    console.log(`    ${sig.summary}`);
    console.log(`    fields:`);
    console.log(
      `      gp=${sig.fields.gp ?? "?"}`,
    );
    console.log(
      `      fund_name=${sig.fields.fund_name ?? "?"}`,
    );
    console.log(
      `      amount_usd=${sig.fields.amount_usd ?? "?"}`,
    );
    console.log(`      asset_class=${sig.asset_class ?? "?"}`);
    console.log(
      `      approval_type=${sig.fields.approval_type ?? "?"}`,
    );
    console.log(
      `      approval_date=${sig.fields.approval_date ?? "?"}`,
    );
    console.log(
      `      fund_stage=${sig.fields.fund_stage ?? "(not set)"}`,
    );
    const lps = sig.fields.named_lps;
    console.log(
      `      named_lps=${Array.isArray(lps) ? JSON.stringify(lps) : "(not set)"}`,
    );
    console.log(
      `    quote: "${sig.source_quote.slice(0, 160)}${sig.source_quote.length > 160 ? "…" : ""}"`,
    );
    console.log(`    source: ${sig.document?.source_url ?? "?"}`);
    console.log();
  }

  console.log("=== rejected_signals from gp_press_release docs (this run) ===\n");
  const { data: rejs } = await s
    .from("rejected_signals")
    .select(
      "id, signal_type, confidence, asset_class, summary, rejection_reason, prompt_version, source_quote, document:documents(source_url, document_type), gp:gps(name), created_at",
    )
    .eq("prompt_version", "v2.2-gp")
    .order("created_at", { ascending: false });

  const rejRows = (rejs ?? []) as unknown as Array<{
    signal_type: number;
    confidence: number;
    asset_class: string | null;
    summary: string;
    rejection_reason: string;
    source_quote: string;
    document: { source_url: string } | null;
    gp: { name: string } | null;
  }>;
  if (rejRows.length === 0) {
    console.log("  (none)\n");
  } else {
    for (const r of rejRows) {
      console.log(
        `  [T${r.signal_type}] conf=${r.confidence.toFixed(2)}  reason=${r.rejection_reason}  gp=${r.gp?.name ?? "?"}`,
      );
      console.log(`    ${r.summary}`);
      console.log(`    quote: "${r.source_quote.slice(0, 160)}"`);
      console.log();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
