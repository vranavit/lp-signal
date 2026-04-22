/**
 * Dump the full text of scraped GP press releases so we can see exactly
 * what the classifier will see before we finalize the prompt.
 */
import { Client } from "pg";

async function main() {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    const r = await c.query(`
      select d.id, d.source_url, d.meeting_date, d.published_at,
             d.content_text, g.name as gp_name,
             length(d.content_text) as len
      from public.documents d
      join public.gps g on g.id = d.gp_id
      where d.document_type = 'gp_press_release'
      order by d.published_at desc nulls last
    `);

    console.log(`\n=== ${r.rowCount} GP press-release samples ===\n`);
    let i = 1;
    for (const row of r.rows) {
      console.log(`----- SAMPLE ${i} ----------------------------------------`);
      console.log(`GP: ${row.gp_name}`);
      console.log(`Published: ${row.published_at}`);
      console.log(`URL: ${row.source_url}`);
      console.log(`Length: ${row.len} chars`);
      console.log(``);
      console.log(row.content_text);
      console.log(``);
      i += 1;
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
