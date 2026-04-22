import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function main() {
  const s = createSupabaseAdminClient();
  const { data: gps } = await s
    .from("gps")
    .select("id, name, press_releases_url, active");
  console.log("gps:", JSON.stringify(gps, null, 2));

  const { count: gpDocs } = await s
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("document_type", "gp_press_release");
  console.log("gp_press_release docs in DB:", gpDocs);

  const { data: gpDocsSample } = await s
    .from("documents")
    .select("id, source_url, processing_status, error_message, published_at")
    .eq("document_type", "gp_press_release")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("sample:", JSON.stringify(gpDocsSample, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
