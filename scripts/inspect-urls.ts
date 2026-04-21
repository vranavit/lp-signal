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
      select d.id, d.source_url, d.processing_status, d.api_tokens_used,
             p.name as plan_name,
             (select pg_column_size(null)) as _null
      from public.documents d
      join public.plans p on p.id = d.plan_id
      order by d.api_tokens_used desc nulls last, d.created_at asc
    `);
    console.log(`documents: ${docs.rowCount}`);
    for (const r of docs.rows) {
      console.log(
        `  [${r.processing_status}] tokens=${r.api_tokens_used ?? "-"} ${r.source_url}`,
      );
    }
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
