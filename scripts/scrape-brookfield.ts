/**
 * One-off runner for the Brookfield press-release scraper.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-brookfield.ts [daysBack=90] [maxKept=20]
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { brookfieldConfig } from "@/lib/scrapers/brookfield";
import {
  matchedKeywords,
  scrapeGpPressReleases,
} from "@/lib/scrapers/gp-press-release";

async function main() {
  const daysBack = Number(process.argv[2] ?? "90");
  const maxKept = Number(process.argv[3] ?? "20");

  const supabase = createSupabaseAdminClient();
  const r = await scrapeGpPressReleases(supabase, brookfieldConfig, {
    daysBack,
    maxKept,
    maxProbed: 50,
  });

  console.log(`\n== Brookfield scrape summary ==`);
  console.log(`Index article URLs found: ${r.found}`);
  console.log(`Probed articles:          ${r.processed}`);
  console.log(`Kept (inserted):          ${r.kept}`);
  console.log(`Filtered — too short:     ${r.filtered_too_short}`);
  console.log(`Filtered — older than cut:${r.filtered_old}`);
  console.log(`Filtered — no keywords:   ${r.filtered_no_keywords}`);
  console.log(`Skipped (duplicate hash): ${r.skipped_duplicate}`);
  console.log(`Errors:                   ${r.errors.length}`);
  for (const e of r.errors) console.log(`  ! ${e.url}: ${e.message}`);

  if (r.inserted.length > 0) {
    console.log(`\n== Inserted articles ==`);
    for (const a of r.inserted) {
      console.log(
        `  ${a.publishedAt?.slice(0, 10) ?? "?"}  ${a.title}  (${a.text.length} chars)`,
      );
      console.log(`    ${a.url}`);
      console.log(`    keywords: ${matchedKeywords(a.text).join(", ")}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
