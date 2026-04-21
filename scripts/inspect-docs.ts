/**
 * Quick read-only status check for documents/signals during Phase 2 dev.
 */
import { Client } from "pg";

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL not set");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const docs = await client.query(`
      select d.id, d.processing_status, d.storage_path, d.meeting_date,
             d.api_tokens_used, d.error_message, p.name as plan_name
      from public.documents d
      join public.plans p on p.id = d.plan_id
      order by d.created_at asc
    `);
    console.log(`documents: ${docs.rowCount}`);
    for (const r of docs.rows) {
      console.log(
        `  [${r.processing_status}] ${r.plan_name} storage=${r.storage_path ?? "-"} tokens=${r.api_tokens_used ?? "-"} err=${r.error_message ?? ""}`,
      );
    }
    const counts = await client.query(`
      select processing_status, count(*)::int as n
      from public.documents group by 1
    `);
    console.log("\nby status:");
    for (const r of counts.rows) console.log(`  ${r.processing_status}: ${r.n}`);

    const signals = await client.query(`
      select count(*)::int as total,
             count(*) filter (where seed_data = false)::int as real,
             count(*) filter (where seed_data = true)::int as seed
      from public.signals
    `);
    console.log("\nsignals:", signals.rows[0]);
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
