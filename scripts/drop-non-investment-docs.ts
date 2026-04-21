import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function main() {
  const s = createSupabaseAdminClient();
  const { data, error } = await s
    .from("documents")
    .delete()
    .ilike("source_url", "%lincoln-plaza%")
    .select("id, source_url");
  if (error) throw error;
  console.log(`Deleted ${data?.length ?? 0} rows`);
  for (const r of data ?? []) console.log(`  - ${r.source_url}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
