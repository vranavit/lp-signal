/**
 * One-off historical scraper for a specific CalPERS Investment Committee
 * meeting. Phase 2 validation: used to pull the November 18, 2024 meeting
 * (known-good — includes the $500M Blackstone Strategic Partners Fund IX
 * commitment) so we can test the classifier against confirmed signals.
 *
 * Usage:
 *   pnpm tsx scripts/scrape-historical-calpers.ts
 *   pnpm tsx scripts/scrape-historical-calpers.ts <meeting-url> <YYYY-MM-DD>
 */

import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const DEFAULT_CANDIDATES = [
  "https://www.calpers.ca.gov/about/board/board-meetings/invest-202411",
  "https://www.calpers.ca.gov/about/board/board-meetings/invest-202411-18",
  "https://www.calpers.ca.gov/about/board/board-meetings/invest-202411-1",
];
const DEFAULT_MEETING_DATE = "2024-11-18";
const USER_AGENT = "lp-signal/0.1 (+https://github.com/vranavit/lp-signal)";
const STORAGE_BUCKET = "documents";

async function fetchFirstAvailable(urls: string[]): Promise<{
  url: string;
  html: string;
}> {
  for (const url of urls) {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      redirect: "follow",
    });
    if (res.ok) {
      return { url, html: await res.text() };
    }
    console.log(`  miss ${res.status} ${url}`);
  }
  throw new Error(
    `no meeting URL resolved; tried: ${urls.join(", ")}`,
  );
}

async function main() {
  const argUrl = process.argv[2];
  const argDate = process.argv[3];
  const candidates = argUrl ? [argUrl] : DEFAULT_CANDIDATES;
  const meetingDate = argDate ?? DEFAULT_MEETING_DATE;

  const supabase = createSupabaseAdminClient();

  const { data: plan, error: pe } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "CalPERS")
    .single();
  if (pe || !plan) throw new Error(`CalPERS plan not found: ${pe?.message}`);
  console.log(`Plan: ${plan.name} (${plan.id})`);

  console.log(`Resolving meeting URL from candidates:`);
  for (const c of candidates) console.log(`  - ${c}`);
  const { url: meetingUrl, html } = await fetchFirstAvailable(candidates);
  console.log(`\nUsing meeting URL: ${meetingUrl}`);
  console.log(`Meeting date: ${meetingDate}\n`);

  const $ = cheerio.load(html);
  const docUrls: string[] = [];
  const seen = new Set<string>();

  $("a").each((_, el) => {
    const href = $(el).attr("href");
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

  console.log(`Found ${docUrls.length} candidate document URLs on the meeting page.`);
  if (docUrls.length === 0) {
    console.log("No documents found — meeting page structure may be different.");
    process.exit(2);
  }

  let inserted = 0;
  let skipped = 0;
  const errors: { url: string; message: string }[] = [];

  for (const pdfUrl of docUrls) {
    try {
      const dRes = await fetch(pdfUrl, {
        headers: { "user-agent": USER_AGENT },
        redirect: "follow",
      });
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
        skipped += 1;
        console.log(`  skip (exists): ${pdfUrl}`);
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

      inserted += 1;
      console.log(`  + ${pdfUrl}`);
      console.log(`    → ${storagePath} (${(bytes.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      errors.push({
        url: pdfUrl,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(`\nInserted: ${inserted}`);
  console.log(`Skipped (duplicate): ${skipped}`);
  console.log(`Errors: ${errors.length}`);
  for (const e of errors) console.log(`  ! ${e.url}: ${e.message}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
