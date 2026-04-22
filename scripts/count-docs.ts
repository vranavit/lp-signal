import { Client } from "pg";
async function main() {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const r = await c.query(
    `select processing_status, count(*)::int n from public.documents group by 1 order by 1`,
  );
  for (const row of r.rows) console.log(`${row.processing_status}: ${row.n}`);
  await c.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
