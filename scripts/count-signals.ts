import { Client } from "pg";
async function main() {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const r = await c.query(`
    select
      count(*)::int as total,
      count(*) filter (where validated_at is null and seed_data=false)::int as pending_review,
      count(*) filter (where validated_at is not null)::int as validated,
      count(*) filter (where seed_data=true)::int as seed
    from public.signals
  `);
  console.log(r.rows[0]);

  const byDate = await c.query(`
    select d.meeting_date, count(s.id)::int as n
    from public.documents d
    left join public.signals s on s.document_id = d.id and s.seed_data = false
    where s.id is not null
    group by d.meeting_date
    order by d.meeting_date desc
  `);
  console.log("\nSignals by meeting_date:");
  for (const row of byDate.rows) console.log(`  ${row.meeting_date}: ${row.n}`);
  await c.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
