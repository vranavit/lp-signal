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
    const rows = await client.query(`
      select s.id, s.signal_type, s.confidence, s.priority_score,
             s.asset_class, s.commitment_amount_usd, s.summary,
             s.source_page, s.source_quote, s.fields,
             d.source_url, d.meeting_date
      from public.signals s
      join public.documents d on d.id = s.document_id
      where s.seed_data = false
      order by s.confidence desc, s.priority_score desc
    `);
    console.log(`Real (non-seed) signals: ${rows.rowCount}\n`);
    for (const r of rows.rows) {
      const amount =
        r.commitment_amount_usd != null
          ? `$${Number(r.commitment_amount_usd).toLocaleString()}`
          : "—";
      console.log(
        `T${r.signal_type} conf=${r.confidence} score=${r.priority_score} ${r.asset_class} amount=${amount}`,
      );
      console.log(`  summary: ${r.summary}`);
      console.log(
        `  fields: ${JSON.stringify(r.fields)}`,
      );
      console.log(`  quote (p${r.source_page}): "${r.source_quote}"`);
      console.log(`  url: ${r.source_url}`);
      console.log();
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
