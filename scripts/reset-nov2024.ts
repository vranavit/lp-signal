/**
 * Reset the Nov 2024 CalPERS batch so we can re-run the classifier with the
 * new prompt + new model. Deletes real (non-seed) signals and flips Nov 2024
 * documents back to processing_status = 'pending'.
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
    const del = await client.query(
      `delete from public.signals where seed_data = false returning id`,
    );
    console.log(`Deleted ${del.rowCount} real signals`);

    const upd = await client.query(
      `update public.documents
         set processing_status = 'pending',
             processed_at = null,
             error_message = null,
             api_tokens_used = null
       where meeting_date = '2024-11-18'
       returning id`,
    );
    console.log(`Reset ${upd.rowCount} documents to pending`);
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
