/**
 * Reset one or more documents back to processing_status='pending', clearing
 * error_message. Useful when we fix a classifier bug and want to re-run
 * against previously-errored docs.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/reset-doc.ts <doc-id> [<doc-id> ...]
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Usage: reset-doc.ts <doc-id> [<doc-id> ...]");
    process.exit(1);
  }

  const supabase = createSupabaseAdminClient();

  for (const id of ids) {
    const { data: before } = await supabase
      .from("documents")
      .select("id, processing_status, error_message, source_url")
      .eq("id", id)
      .maybeSingle();
    if (!before) {
      console.error(`  ${id}: not found`);
      continue;
    }
    console.log(
      `  ${id}: ${before.processing_status} → pending  (${before.source_url})`,
    );
    if (before.error_message) {
      console.log(
        `    was: ${before.error_message.slice(0, 120)}${before.error_message.length > 120 ? "…" : ""}`,
      );
    }
    const { error } = await supabase
      .from("documents")
      .update({
        processing_status: "pending",
        error_message: null,
        processed_at: null,
      })
      .eq("id", id);
    if (error) {
      console.error(`    FAIL: ${error.message}`);
    } else {
      console.log(`    ok`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
