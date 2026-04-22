/**
 * Validate prompt v2.2 rules against the current signals table.
 *
 * Applies the v2.2 rejection heuristics — index-allocation NOISE rule,
 * public-equity NOISE rule, and the "no asset_class='Other'" hard guardrail
 * — to every signal currently in the DB and reports which would have been
 * rejected. Pure Postgres reads, zero API cost.
 *
 * Intended as a pre-rollout sanity check: before burning API credits on a
 * full re-classification, confirm the new rules catch the known false
 * positives (FTSE climate index, CC&L / Lazard public-equity mandates) and
 * do not over-reject anything we want to keep.
 *
 * Usage:
 *   pnpm tsx scripts/validate-prompt-v22.ts
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SignalRow = {
  id: string;
  signal_type: 1 | 2 | 3;
  confidence: number;
  asset_class: string | null;
  summary: string;
  source_quote: string | null;
  preliminary: boolean;
  seed_data: boolean;
  fields: Record<string, unknown> | null;
  created_at: string;
  plan: { name: string } | null;
};

// Index-provider / index-allocation keywords. Matched case-insensitively
// against gp, fund_name, summary, and source_quote.
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

// Public-equity mandate context. Matched case-insensitively against summary
// and source_quote. These are sleeve / section / program names, not GPs.
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

  // Index rule — highest-leverage check is on gp/fund_name (the "who" and
  // "what fund"). Summary/quote are a secondary safety net.
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

  // Public-equity rule — check summary/quote (sleeve names usually appear in
  // the surrounding context, not in the GP or fund field).
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
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("signals")
    .select(
      "id, signal_type, confidence, asset_class, summary, source_quote, preliminary, seed_data, fields, created_at, plan:plans(name)",
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    console.error("query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as unknown as SignalRow[];
  console.log(`Loaded ${rows.length} signals from DB.\n`);

  const rejected: Array<SignalRow & { reasons: Reason[] }> = [];
  const ruleCounts = new Map<string, number>();
  let seedCount = 0;
  let liveCount = 0;
  let prelimCount = 0;

  for (const r of rows) {
    if (r.seed_data) seedCount++;
    else liveCount++;
    if (r.preliminary) prelimCount++;

    const reasons = evaluate(r);
    if (reasons.length > 0) {
      rejected.push({ ...r, reasons });
      for (const reason of reasons) {
        ruleCounts.set(reason.rule, (ruleCounts.get(reason.rule) ?? 0) + 1);
      }
    }
  }

  console.log("— Corpus composition —");
  console.log(`  total:        ${rows.length}`);
  console.log(`  seed_data:    ${seedCount}`);
  console.log(`  live:         ${liveCount}`);
  console.log(`  preliminary:  ${prelimCount}\n`);

  console.log("— v2.2 rejection summary —");
  console.log(
    `  Would reject: ${rejected.length} of ${rows.length} (${pct(rejected.length, rows.length)}%)`,
  );
  for (const [rule, count] of ruleCounts) {
    console.log(`    ${rule.padEnd(22)} ${count}`);
  }
  console.log();

  if (rejected.length === 0) {
    console.log(
      "No signals would be rejected under v2.2. Either the corpus is already clean or the heuristics are too loose.",
    );
    return;
  }

  console.log("— Would-be rejections (newest first) —\n");
  for (const r of rejected) {
    const tag = `T${r.signal_type}${r.seed_data ? " seed" : ""}${r.preliminary ? " prelim" : ""}`;
    const plan = r.plan?.name ?? "(unknown)";
    const ac = r.asset_class ?? "—";
    const conf = r.confidence.toFixed(2);
    console.log(`  [${tag}] ${plan}  conf=${conf}  asset=${ac}`);
    console.log(`    ${r.summary}`);
    const gp =
      typeof r.fields?.gp === "string" ? (r.fields.gp as string) : null;
    const fundName =
      typeof r.fields?.fund_name === "string"
        ? (r.fields.fund_name as string)
        : null;
    if (gp || fundName) {
      console.log(`    gp=${gp ?? "—"}  fund=${fundName ?? "—"}`);
    }
    if (r.source_quote) {
      console.log(
        `    quote: "${r.source_quote.slice(0, 140)}${r.source_quote.length > 140 ? "…" : ""}"`,
      );
    }
    for (const reason of r.reasons) {
      console.log(
        `    → reject (${reason.rule}): matched "${reason.match}" in ${reason.field}`,
      );
    }
    console.log();
  }
}

function pct(num: number, den: number): string {
  if (den === 0) return "0.0";
  return ((num / den) * 100).toFixed(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
