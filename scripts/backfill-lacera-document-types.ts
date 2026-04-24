/**
 * Backfill LACERA documents.document_type using the same URL-pattern
 * rule the live scraper now applies at insert time
 * (`laceraDocumentType`). Idempotent — rows already carrying the
 * correct type are skipped. Prints a per-type tally before and after.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-lacera-document-types.ts
 *   pnpm tsx scripts/backfill-lacera-document-types.ts --dry-run
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { laceraDocumentType } from "@/lib/scrapers/lacera";

type DocRow = {
  id: string;
  source_url: string;
  document_type: string | null;
  processing_status: string;
  error_message: string | null;
};

function parseArgs() {
  const dryRun = process.argv.includes("--dry-run");
  return { dryRun };
}

async function main() {
  const { dryRun } = parseArgs();
  const supabase = createSupabaseAdminClient();

  const { data: plans, error: planErr } = await supabase
    .from("plans")
    .select("id, name")
    .eq("scrape_config->>key", "lacera")
    .limit(1);
  if (planErr) throw planErr;
  const plan = plans?.[0];
  if (!plan) throw new Error("LACERA plan not seeded");
  console.log(`Plan: ${plan.name} (${plan.id})`);

  const { data: docs, error: docErr } = await supabase
    .from("documents")
    .select("id, source_url, document_type, processing_status, error_message")
    .eq("plan_id", plan.id);
  if (docErr) throw docErr;
  const rows = (docs ?? []) as DocRow[];
  console.log(`LACERA documents: ${rows.length}`);

  const before = tallyBy(rows, (d) => d.document_type ?? "null");
  console.log("\nBefore:");
  for (const [k, v] of before) console.log(`  ${k}: ${v}`);

  let updated = 0;
  let unchanged = 0;
  for (const d of rows) {
    const desired = laceraDocumentType(d.source_url);
    if (d.document_type === desired) {
      unchanged++;
      continue;
    }
    if (dryRun) {
      console.log(
        `  would update ${d.id} (${d.source_url.slice(-60)}) ${d.document_type ?? "null"} → ${desired}`,
      );
      updated++;
      continue;
    }
    const { error: upErr } = await supabase
      .from("documents")
      .update({ document_type: desired })
      .eq("id", d.id);
    if (upErr) {
      console.error(`  ! update failed for ${d.id}: ${upErr.message}`);
      continue;
    }
    updated++;
  }

  console.log(
    `\n${dryRun ? "DRY RUN · " : ""}updated=${updated} unchanged=${unchanged}`,
  );

  if (!dryRun) {
    const { data: after } = await supabase
      .from("documents")
      .select("document_type")
      .eq("plan_id", plan.id);
    const afterTally = tallyBy(
      (after ?? []) as { document_type: string | null }[],
      (d) => d.document_type ?? "null",
    );
    console.log("\nAfter:");
    for (const [k, v] of afterTally) console.log(`  ${k}: ${v}`);
  }
}

function tallyBy<T>(rows: T[], key: (r: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
