/**
 * One-off runner for the Brookfield press-release scraper.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-brookfield.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-brookfield.ts --days=365
 *   pnpm tsx --env-file=.env.local scripts/scrape-brookfield.ts --days=365 --max-kept=100 --max-probed=200
 *
 * Flags (all optional):
 *   --days=N        (default 90)   Ignore articles older than N days.
 *   --max-kept=N    (default 20)   Stop after inserting N articles (safety cap).
 *   --max-probed=N  (default 50)   Articles to deep-fetch from the index list.
 *
 * Legacy positional args still work:
 *   pnpm tsx scripts/scrape-brookfield.ts 90 20
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { brookfieldConfig } from "@/lib/scrapers/brookfield";
import {
  matchedKeywords,
  scrapeGpPressReleases,
} from "@/lib/scrapers/gp-press-release";

function parseArgs() {
  const args = process.argv.slice(2);
  let days = 90;
  let maxKept = 20;
  let maxProbed = 50;

  const positional: string[] = [];
  for (const a of args) {
    if (a.startsWith("--days=")) {
      days = Number(a.slice("--days=".length));
    } else if (a.startsWith("--max-kept=")) {
      maxKept = Number(a.slice("--max-kept=".length));
    } else if (a.startsWith("--max-probed=")) {
      maxProbed = Number(a.slice("--max-probed=".length));
    } else if (!a.startsWith("--")) {
      positional.push(a);
    }
  }
  if (positional.length > 0) days = Number(positional[0]) || days;
  if (positional.length > 1) maxKept = Number(positional[1]) || maxKept;

  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`invalid --days=${days}`);
  }
  if (!Number.isFinite(maxKept) || maxKept <= 0) {
    throw new Error(`invalid --max-kept=${maxKept}`);
  }
  return { days, maxKept, maxProbed };
}

async function main() {
  const { days, maxKept, maxProbed } = parseArgs();

  console.log(
    `[brookfield] days=${days} maxKept=${maxKept} maxProbed=${maxProbed}`,
  );

  const supabase = createSupabaseAdminClient();
  const r = await scrapeGpPressReleases(supabase, brookfieldConfig, {
    daysBack: days,
    maxKept,
    maxProbed,
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
