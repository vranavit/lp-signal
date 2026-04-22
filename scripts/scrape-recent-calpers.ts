/**
 * Pull the N most recent CalPERS Investment Committee meetings from the
 * board-meetings index and insert all of their document links into the
 * documents table as processing_status = 'pending'. Dedupe by content_hash.
 *
 * Usage:
 *   pnpm tsx scripts/scrape-recent-calpers.ts            # default N=3
 *   pnpm tsx scripts/scrape-recent-calpers.ts 5
 */

import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const INDEX_URL =
  "https://www.calpers.ca.gov/about/board/board-meetings";
const USER_AGENT = "lp-signal/0.1 (+https://github.com/vranavit/lp-signal)";
const STORAGE_BUCKET = "documents";

const MONTH_ABBR: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/**
 * CalPERS uses a path convention `/documents/YYYYMM-invest-<slug>-MMM<dd>/`.
 * Example: `202603-invest-transcript-mar17` → 2026-03-17.
 * Falls back to the first of the month if only YYYYMM is present.
 */
function parseMeetingDateFromUrl(url: string): string | null {
  const full = url.match(
    /\/documents\/(\d{4})(\d{2})-invest-.+?-([a-z]{3})(\d{1,2})\//i,
  );
  if (full) {
    const [, year, month, , day] = full;
    return `${year}-${month}-${day.padStart(2, "0")}`;
  }
  const ym = url.match(/\/documents\/(\d{4})(\d{2})-invest-/i);
  if (ym) return `${ym[1]}-${ym[2]}-01`;
  return null;
}

/**
 * Extract meeting date from a meeting-page URL when the path doesn't include
 * a day, e.g. `/board-meetings/invest-202603` or `/board-meetings/invest-202603-2`.
 */
function parseMeetingDateFromMeetingUrl(url: string): string | null {
  const m = url.match(/\/board-meetings\/invest-(\d{4})(\d{2})(?:-\d+)?\/?$/i);
  if (!m) return null;
  return `${m[1]}-${m[2]}-01`;
}

async function httpGet(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "user-agent": USER_AGENT },
    redirect: "follow",
    cache: "no-store",
  });
}

async function main() {
  const nArg = Number(process.argv[2] ?? "3");
  const maxMeetings = Math.max(1, Math.min(12, Number.isFinite(nArg) ? nArg : 3));

  const supabase = createSupabaseAdminClient();

  const { data: plan, error: pe } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "CalPERS")
    .single();
  if (pe || !plan) throw new Error(`CalPERS plan not found: ${pe?.message}`);
  console.log(`Plan: ${plan.name} (${plan.id})`);

  console.log(`Fetching index: ${INDEX_URL}`);
  const idx = await httpGet(INDEX_URL);
  if (!idx.ok) throw new Error(`index fetch failed: ${idx.status}`);
  const $index = cheerio.load(await idx.text());

  const meetingUrls: string[] = [];
  const seenMeetings = new Set<string>();
  $index('a[href*="/board-meetings/invest-"]').each((_, el) => {
    const href = $index(el).attr("href");
    if (!href) return;
    const abs = new URL(href, INDEX_URL).toString();
    if (!seenMeetings.has(abs)) {
      seenMeetings.add(abs);
      meetingUrls.push(abs);
    }
  });

  if (meetingUrls.length === 0) {
    throw new Error("no invest- meeting links found on board-meetings index");
  }

  const target = meetingUrls.slice(0, maxMeetings);
  console.log(`Top ${target.length} meetings (most recent first per index order):`);
  for (const u of target) console.log(`  - ${u}`);

  let totalInserted = 0;
  let totalSkipped = 0;
  const errors: { url: string; message: string }[] = [];

  for (const meetingUrl of target) {
    console.log(`\n== ${meetingUrl}`);
    const fallbackDate = parseMeetingDateFromMeetingUrl(meetingUrl);

    const res = await httpGet(meetingUrl);
    if (!res.ok) {
      console.log(`  skip — meeting page HTTP ${res.status}`);
      continue;
    }
    const $m = cheerio.load(await res.text());
    const docUrls: string[] = [];
    const seen = new Set<string>();
    $m("a").each((_, el) => {
      const href = $m(el).attr("href");
      if (!href) return;
      const abs = new URL(href, meetingUrl).toString();
      if (seen.has(abs)) return;
      const isDocLink = abs.includes("/documents/") && abs.includes("/download");
      const isPdf = abs.toLowerCase().includes(".pdf");
      if (isDocLink || isPdf) {
        seen.add(abs);
        docUrls.push(abs);
      }
    });
    console.log(`  found ${docUrls.length} candidate docs`);

    for (const pdfUrl of docUrls) {
      try {
        const dRes = await httpGet(pdfUrl);
        if (!dRes.ok) {
          errors.push({ url: pdfUrl, message: `HTTP ${dRes.status}` });
          continue;
        }
        const contentType = (dRes.headers.get("content-type") ?? "").toLowerCase();
        if (!contentType.includes("pdf")) {
          errors.push({ url: pdfUrl, message: `not pdf: ${contentType}` });
          continue;
        }
        const bytes = new Uint8Array(await dRes.arrayBuffer());
        const hash = createHash("sha256").update(bytes).digest("hex");

        const { data: existing } = await supabase
          .from("documents")
          .select("id")
          .eq("plan_id", plan.id)
          .eq("content_hash", hash)
          .maybeSingle();
        if (existing) {
          totalSkipped += 1;
          continue;
        }

        const storagePath = `calpers/${hash}.pdf`;
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, bytes, {
            contentType: "application/pdf",
            upsert: true,
          });
        if (upErr) throw upErr;

        const meetingDate =
          parseMeetingDateFromUrl(pdfUrl) ?? fallbackDate ?? null;

        const { error: insErr } = await supabase.from("documents").insert({
          plan_id: plan.id,
          document_type: "board_minutes",
          source_url: pdfUrl,
          content_hash: hash,
          storage_path: storagePath,
          processing_status: "pending",
          meeting_date: meetingDate,
        });
        if (insErr) throw insErr;

        totalInserted += 1;
        console.log(
          `  + ${pdfUrl}  (${(bytes.length / 1024).toFixed(0)} KB, ${meetingDate ?? "no-date"})`,
        );
      } catch (err) {
        errors.push({
          url: pdfUrl,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  console.log(`\n== Totals`);
  console.log(`Inserted: ${totalInserted}`);
  console.log(`Skipped (already in DB): ${totalSkipped}`);
  console.log(`Errors: ${errors.length}`);
  for (const e of errors) console.log(`  ! ${e.url}: ${e.message}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
