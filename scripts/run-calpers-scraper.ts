#!/usr/bin/env tsx
/**
 * Manually run the CalPERS scraper from the CLI.
 * Reads .env.local, uses the service-role key, writes to Supabase Storage + DB.
 *
 *   pnpm scrape:calpers
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { scrapeCalPERS } from "../lib/scrapers/calpers";

function loadDotEnv(path: string) {
  try {
    const contents = readFileSync(path, "utf8");
    for (const rawLine of contents.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env.local missing — fall through and let the checks below explain why.
  }
}

loadDotEnv(`${process.cwd()}/.env.local`);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local",
  );
  process.exit(1);
}

const supabase = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "CalPERS")
    .eq("country", "US")
    .maybeSingle();

  if (error || !plan) {
    console.error(
      "CalPERS plan row not found. Did migrations run? Error:",
      error?.message,
    );
    process.exit(1);
  }

  console.log(`Running CalPERS scraper for plan ${plan.id}…`);
  const result = await scrapeCalPERS(supabase, { planId: plan.id, maxPdfs: 5 });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
