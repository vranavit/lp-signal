/**
 * CalPERS allocation ingestion — replacement for the oversized full ACFR.
 *
 * Day 4 result: acfr-2025 (30 MB) > Anthropic 32 MB limit; annual-investment-
 * report-fy-2025 (20.8 MB, 440 pages, 1.3M tokens) > Sonnet 1M context.
 *
 * Day 5 finding: CalPERS no longer publishes monthly SAA updates — the
 * Committee approved a Reference Portfolio / Active Risk Limit "in lieu of a
 * Strategic Asset Allocation" effective July 2026. The nearest remaining
 * source of current allocation data is the Total Fund Policy Review item
 * posted ~twice a year to Investment Committee board packets.
 *
 * This runner walks the last 3 IC meetings, probes for Total Fund Policy
 * Review / Asset Allocation items, and ingests up to 3 of them. Falls back
 * to the Affiliates Quarterly Update attachments if no policy item is found
 * in a given meeting.
 */

import * as cheerio from "cheerio";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchWithDefaults } from "@/lib/scrapers/http";
import { ingestCafr } from "@/lib/scrapers/cafr";

const BOARD_MEETINGS_INDEX =
  "https://www.calpers.ca.gov/about/board/board-meetings";
const MAX_MEETINGS = 3;
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — stay well under Anthropic 32 MB after base64.

type Candidate = {
  url: string;
  title: string;
  meetingKey: string; // e.g. "202603"
};

function parseFiscalYearEnd(meetingKey: string): string {
  // meetingKey is YYYYMM. We treat the as_of date as the 1st of that month
  // so policy-change detection has a stable comparable date even though the
  // underlying allocation figures may reflect a slightly earlier period.
  const y = meetingKey.slice(0, 4);
  const m = meetingKey.slice(4, 6);
  return `${y}-${m}-01`;
}

async function discoverCandidates(): Promise<Candidate[]> {
  const indexRes = await fetchWithDefaults(BOARD_MEETINGS_INDEX);
  if (!indexRes.ok) {
    throw new Error(
      `index fetch failed: ${indexRes.status} ${indexRes.statusText}`,
    );
  }
  const $index = cheerio.load(await indexRes.text());
  const meetings: { url: string; key: string }[] = [];
  const seen = new Set<string>();

  $index('a[href*="/board-meetings/invest-"]').each((_, el) => {
    const href = $index(el).attr("href");
    if (!href) return;
    const abs = new URL(href, BOARD_MEETINGS_INDEX).toString();
    const match = abs.match(/invest-(\d{6})(?:-\d+)?\/?$/);
    if (!match) return;
    const key = match[1];
    if (seen.has(abs)) return;
    seen.add(abs);
    meetings.push({ url: abs, key });
  });

  meetings.sort((a, b) => b.key.localeCompare(a.key));
  const recent = meetings.slice(0, MAX_MEETINGS);

  const candidates: Candidate[] = [];
  for (const m of recent) {
    try {
      const res = await fetchWithDefaults(m.url);
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);

      // Preferred: Total Fund Policy / Asset Allocation / SAA agenda items.
      // Fallback: Affiliates Quarterly attachment, which surfaces current
      // allocation and policy weights for the smaller CalPERS plans.
      const wanted: string[] = [];
      $("a").each((_, el) => {
        const href = $(el).attr("href");
        if (!href || !href.includes("/documents/")) return;
        const text = $(el).text().trim();
        const isPolicy =
          /total fund policy/i.test(text) ||
          /strategic asset allocation/i.test(text) ||
          /\basset allocation\b/i.test(text) ||
          /reference portfolio/i.test(text);
        const isAffiliates = /affiliates.*(performance|risk)/i.test(text);
        if (!isPolicy && !isAffiliates) return;
        // Skip pure transcripts / cover memos whose title is just "Attachment N".
        if (/^attachment\s+\d+/i.test(text)) return;

        const abs = new URL(href, m.url).toString();
        if (!wanted.includes(abs)) wanted.push(abs);
      });

      // If we found any matching anchors, prefer attachment-1 (presentation)
      // hrefs over cover memos. CalPERS item slugs end in `-00-a-…` for the
      // cover and `-01-a-…` etc. for attachments.
      const preferred =
        wanted.find((u) => /-item\d+[a-z]?-01-a-/i.test(u)) ??
        wanted.find((u) => /-item\d+[a-z]?-00-a-/i.test(u)) ??
        wanted[0];

      if (preferred) {
        candidates.push({
          url: preferred,
          title: `CalPERS ${m.key} policy/allocation item`,
          meetingKey: m.key,
        });
      }
    } catch {
      // one meeting failure doesn't kill the sweep
    }
  }
  return candidates;
}

async function main() {
  const supabase = createSupabaseAdminClient();

  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "CalPERS")
    .single();
  if (error || !plan) throw new Error(`CalPERS not found: ${error?.message}`);
  console.log(`Plan: ${plan.name} (${plan.id})`);

  const candidates = await discoverCandidates();
  console.log(`\nDiscovered ${candidates.length} candidate PDFs:`);
  for (const c of candidates) console.log(`  · ${c.meetingKey}: ${c.url}`);
  if (candidates.length === 0) {
    console.log(
      "\nNo Total Fund Policy / Asset Allocation items found across the last " +
        `${MAX_MEETINGS} IC meetings. CalPERS has moved to a Total Portfolio ` +
        "Approach; manual URL override may be needed.",
    );
    return;
  }

  let inserted = 0;
  let skipped = 0;
  let errored = 0;
  for (const cand of candidates) {
    // HEAD-style size probe to skip oversized PDFs without re-downloading.
    const headRes = await fetchWithDefaults(cand.url, { method: "HEAD" });
    const cl = Number(headRes.headers.get("content-length") ?? "0");
    if (cl > MAX_BYTES) {
      console.log(
        `\nSKIP (${(cl / 1024 / 1024).toFixed(1)} MB > ${MAX_BYTES / 1024 / 1024} MB):\n  ${cand.url}`,
      );
      continue;
    }
    const r = await ingestCafr(supabase, {
      planId: plan.id,
      planKey: "calpers",
      url: cand.url,
      fiscalYearEnd: parseFiscalYearEnd(cand.meetingKey),
    });
    console.log(
      `\n${cand.meetingKey}  ${r.fetched ? "fetched" : "NOT"}  ${
        r.inserted ? "inserted" : r.skipped ? "dup" : r.error ?? "error"
      }  (${(r.bytes / 1024 / 1024).toFixed(1)} MB)`,
    );
    console.log(`  ${cand.url}`);
    if (r.inserted) inserted += 1;
    else if (r.skipped) skipped += 1;
    else errored += 1;
  }

  console.log(
    `\n== Totals  inserted=${inserted}  skipped=${skipped}  errored=${errored}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
