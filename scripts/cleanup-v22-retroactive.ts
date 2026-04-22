/**
 * One-off: retroactively apply the v2.2 rejection rules to the existing
 * signals table. Moves matching rows to rejected_signals with
 * rejection_reason='v22_retroactive', prompt_version='v2.2', then deletes
 * them from signals.
 *
 * Dry-run by default. Pass --commit to actually mutate.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/cleanup-v22-retroactive.ts
 *   pnpm tsx --env-file=.env.local scripts/cleanup-v22-retroactive.ts --commit
 *
 * Rules (duplicated from scripts/validate-prompt-v22.ts so this script is
 * self-contained and auditable):
 *   - asset_class === 'Other'
 *   - index-provider keyword in gp / fund_name / summary / source_quote
 *   - public-equity keyword in summary / source_quote
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SignalRow = {
  id: string;
  document_id: string | null;
  plan_id: string;
  signal_type: 1 | 2 | 3;
  confidence: number;
  asset_class: string | null;
  summary: string;
  source_page: number | null;
  source_quote: string | null;
  fields: Record<string, unknown> | null;
  seed_data: boolean;
  preliminary: boolean;
  created_at: string;
  plan: { name: string } | null;
};

const INDEX_KEYWORDS = [
  "FTSE",
  "MSCI",
  "S&P",
  "Bloomberg",
  "Russell",
  "custom index",
  "custom climate",
  "climate transition index",
  "transition index",
  "ESG index",
  "tracking",
];

const PUBLIC_EQUITY_KEYWORDS = [
  "Global Public Equity",
  "Public Equity",
  "Global Equity",
  "Passive Equity",
  "Active Equity",
  "Public Markets",
];

type Reason = { rule: string; match: string; field: string };

function matchAny(
  haystack: string,
  needles: string[],
  field: string,
  rule: string,
): Reason | null {
  const hay = haystack.toLowerCase();
  for (const needle of needles) {
    if (hay.includes(needle.toLowerCase())) {
      return { rule, match: needle, field };
    }
  }
  return null;
}

function evaluate(s: SignalRow): Reason[] {
  const reasons: Reason[] = [];

  if (s.asset_class === "Other") {
    reasons.push({
      rule: "asset_class_other",
      match: "Other",
      field: "asset_class",
    });
  }

  const gp =
    typeof s.fields?.gp === "string" ? (s.fields.gp as string) : "";
  const fundName =
    typeof s.fields?.fund_name === "string"
      ? (s.fields.fund_name as string)
      : "";
  const summary = s.summary ?? "";
  const quote = s.source_quote ?? "";

  const indexChecks: Array<[string, string]> = [
    [gp, "fields.gp"],
    [fundName, "fields.fund_name"],
    [summary, "summary"],
    [quote, "source_quote"],
  ];
  for (const [text, field] of indexChecks) {
    if (!text) continue;
    const m = matchAny(text, INDEX_KEYWORDS, field, "index_allocation");
    if (m) {
      reasons.push(m);
      break;
    }
  }

  const peChecks: Array<[string, string]> = [
    [summary, "summary"],
    [quote, "source_quote"],
  ];
  for (const [text, field] of peChecks) {
    if (!text) continue;
    const m = matchAny(text, PUBLIC_EQUITY_KEYWORDS, field, "public_equity");
    if (m) {
      reasons.push(m);
      break;
    }
  }

  return reasons;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const mode = commit ? "COMMIT" : "DRY-RUN";
  console.log(`Mode: ${mode}\n`);

  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("signals")
    .select(
      "id, document_id, plan_id, signal_type, confidence, asset_class, summary, source_page, source_quote, fields, seed_data, preliminary, created_at, plan:plans(name)",
    );

  if (error) {
    console.error("query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as unknown as SignalRow[];
  const targets = rows
    .map((r) => ({ row: r, reasons: evaluate(r) }))
    .filter((x) => x.reasons.length > 0);

  console.log(
    `Scanned ${rows.length} signals. ${targets.length} match v2.2 rejection rules.\n`,
  );

  if (targets.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const { row, reasons } of targets) {
    const tag = `T${row.signal_type}${row.seed_data ? " seed" : ""}${row.preliminary ? " prelim" : ""}`;
    const plan = row.plan?.name ?? "(unknown)";
    const ac = row.asset_class ?? "—";
    console.log(`  [${tag}] ${plan}  id=${row.id}  asset=${ac}`);
    console.log(`    ${row.summary}`);
    for (const reason of reasons) {
      console.log(
        `    → reject (${reason.rule}): matched "${reason.match}" in ${reason.field}`,
      );
    }
    console.log();
  }

  if (!commit) {
    console.log(
      "Dry-run complete. No changes made. Re-run with --commit to apply.",
    );
    return;
  }

  console.log("Applying changes...\n");
  let ok = 0;
  let failed = 0;

  for (const { row } of targets) {
    try {
      const { error: insErr } = await supabase
        .from("rejected_signals")
        .insert({
          document_id: row.document_id,
          plan_id: row.plan_id,
          signal_type: row.signal_type,
          confidence: row.confidence,
          asset_class: row.asset_class,
          summary: row.summary,
          fields: row.fields ?? {},
          source_page: row.source_page,
          source_quote: row.source_quote ?? "",
          rejection_reason: "v22_retroactive",
          prompt_version: "v2.2",
        });
      if (insErr) throw new Error(`insert_failed: ${insErr.message}`);

      const { error: delErr } = await supabase
        .from("signals")
        .delete()
        .eq("id", row.id);
      if (delErr) {
        // We inserted but couldn't delete — surface loudly so the operator
        // can clean up the duplicate manually. Don't continue blindly.
        throw new Error(
          `delete_failed after insert (MANUAL CLEANUP NEEDED for signal id=${row.id}): ${delErr.message}`,
        );
      }

      console.log(`  ok   id=${row.id}`);
      ok++;
    } catch (err) {
      console.error(
        `  FAIL id=${row.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }

  console.log(`\nDone. ok=${ok} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
