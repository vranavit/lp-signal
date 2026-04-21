/**
 * Apply a single SQL migration file against SUPABASE_DB_URL.
 * Usage: pnpm tsx scripts/apply-migration.ts supabase/migrations/<file>.sql
 */

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

async function main() {
  const [, , fileArg] = process.argv;
  if (!fileArg) {
    console.error("usage: apply-migration.ts <path-to-sql-file>");
    process.exit(2);
  }
  const abs = path.resolve(fileArg);
  const sql = fs.readFileSync(abs, "utf8");

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL not set");

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log(`applied: ${path.basename(abs)}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
