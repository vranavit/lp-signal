import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults } from "./http";

/**
 * Massachusetts Pension Reserves Investment Management Board (PRIM).
 *
 *   Events page:        https://www.mapension.com/events/
 *   Board packets PDF:  https://www.mapension.com/wp-content/uploads/YYYY/MM/
 *                         Board-Meeting-Materials-Website-MMDDYYYY.pdf
 *   Board minutes PDF:  https://www.mapension.com/wp-content/uploads/YYYY/MM/
 *                         Board-Meeting-Minutes-MMDDYYYY.pdf
 *
 * WordPress doesn't expose a usable index page listing every PDF and
 * /wp-json/wp/v2/media is blocked by a 400. The reliable ingestion path is
 * date-candidate generation: PRIM publishes a meeting calendar, we iterate
 * over known Board Meeting dates and probe URLs across a small
 * upload-month window (meetings are typically uploaded 1-3 months after
 * the meeting date).
 *
 * Board meetings are what we want — committee meetings (Investment / Real
 * Estate / Admin) are substantive but heavy-duty operational minutiae.
 * The Board meeting itself ratifies commitments from the committees and
 * is the cleaner commitment-disclosure source.
 *
 * PRIM meets 4 times per year on the Thursday after the Investment
 * Committee week (February, May, August, December). The candidate
 * generator walks a monthsBack window of the last N months and emits
 * Thursday candidates for likely meeting weeks.
 */
const STORAGE_BUCKET = "documents";
const PRIM_BASE = "https://www.mapension.com";

export type MaPrimScrapeResult = {
  candidateUrlsProbed: number;
  pdfsFound: number;
  pdfsFetched: number;
  inserted: number;
  skipped: number;
  notFound: number;
  errors: { url: string; message: string }[];
  totalBytes: number;
};

export type MaPrimCandidate = {
  url: string;
  meetingDate: string; // YYYY-MM-DD
  kind: "packet" | "minutes";
};

export async function scrapeMaPrim(
  supabase: SupabaseClient,
  opts: { planId: string; monthsBack?: number; now?: Date },
): Promise<MaPrimScrapeResult> {
  if (!opts.planId) throw new Error("scrapeMaPrim requires opts.planId");
  const monthsBack = opts.monthsBack ?? 18;

  const candidates = generatePrimCandidates(monthsBack, opts.now);

  const result: MaPrimScrapeResult = {
    candidateUrlsProbed: candidates.length,
    pdfsFound: 0,
    pdfsFetched: 0,
    inserted: 0,
    skipped: 0,
    notFound: 0,
    errors: [],
    totalBytes: 0,
  };

  // Dedup across (meetingDate, kind) — first successful URL wins, but the
  // upload-month window may produce multiple candidate URLs for the same
  // logical doc. Record the successful (date, kind) pair so later
  // candidates pointing at the same doc via a different upload month are
  // skipped.
  const resolvedKeys = new Set<string>();

  for (const cand of candidates) {
    const key = `${cand.meetingDate}-${cand.kind}`;
    if (resolvedKeys.has(key)) continue;
    try {
      const res = await fetchWithDefaults(cand.url);
      if (res.status === 404) {
        result.notFound += 1;
        continue;
      }
      if (!res.ok) {
        result.errors.push({
          url: cand.url,
          message: `HTTP ${res.status} ${res.statusText}`,
        });
        continue;
      }
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("pdf")) {
        // WordPress 404 page comes back as HTML 200 for some requests —
        // drop anything not PDF quietly.
        result.notFound += 1;
        continue;
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      const hash = createHash("sha256").update(bytes).digest("hex");
      result.pdfsFound += 1;
      result.pdfsFetched += 1;
      result.totalBytes += bytes.length;
      resolvedKeys.add(key);

      const { data: existing } = await supabase
        .from("documents")
        .select("id")
        .eq("plan_id", opts.planId)
        .eq("content_hash", hash)
        .maybeSingle();
      if (existing) {
        result.skipped += 1;
        continue;
      }

      const storagePath = `ma-prim/${hash}.pdf`;
      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, bytes, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("documents").insert({
        plan_id: opts.planId,
        document_type: "board_minutes",
        source_url: cand.url,
        content_hash: hash,
        storage_path: storagePath,
        processing_status: "pending",
        meeting_date: cand.meetingDate,
      });
      if (insErr) throw insErr;

      result.inserted += 1;
    } catch (err) {
      result.errors.push({
        url: cand.url,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await supabase
    .from("plans")
    .update({ last_scraped_at: new Date().toISOString() })
    .eq("id", opts.planId);

  return result;
}

/**
 * Emit URL candidates for PRIM Board meetings over the last `monthsBack`
 * months. For each likely Board meeting date, produce:
 *   1. /YYYY/MM/Board-Meeting-Materials-Website-MMDDYYYY.pdf for the
 *      meeting month and the 3 following months (PRIM uploads 1-3 months
 *      after the meeting).
 *   2. /YYYY/MM/Board-Meeting-Minutes-MMDDYYYY.pdf for the same window,
 *      shifted 1 month later (minutes post slightly after packets).
 *
 * The Board meets 4–5 times a year: mid-Feb, mid-May, mid-Aug, mid-Nov,
 * early Dec. For robustness we probe every Thursday of the meeting month
 * to absorb date drift.
 */
export function generatePrimCandidates(
  monthsBack: number,
  now = new Date(),
): MaPrimCandidate[] {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - monthsBack);
  const startYear = cutoff.getUTCFullYear();
  const endYear = now.getUTCFullYear();

  const meetingMonths = [2, 5, 8, 12]; // Feb / May / Aug / Dec.
  const out: MaPrimCandidate[] = [];
  for (let y = startYear; y <= endYear; y++) {
    for (const m of meetingMonths) {
      for (const thu of everyThursdayOfMonth(y, m)) {
        if (thu < cutoff || thu > now) continue;
        const dateStr = thu.toISOString().slice(0, 10);
        const mmddyyyy = `${pad(m)}${pad(thu.getUTCDate())}${y}`;
        // Packets are posted BEFORE the meeting (observed Feb 2025 meeting
        // packet uploaded Dec 2024 — 2 months lead). Probe meeting-month-3
        // through meeting-month-0 to absorb publishing lead-time variance.
        // Skip packet probes when the meeting is >45 days past — PRIM
        // purges old packets from their public URL (minutes stay); probing
        // them wastes 4 requests per past meeting on guaranteed 404s.
        const daysPastMeeting = (now.getTime() - thu.getTime()) / 86_400_000;
        if (daysPastMeeting <= 45) {
          for (let offset = -3; offset <= 0; offset++) {
            const upload = shiftMonth(y, m, offset);
            const base = `${PRIM_BASE}/wp-content/uploads/${upload.y}/${pad(upload.m)}`;
            out.push({
              url: `${base}/Board-Meeting-Materials-Website-${mmddyyyy}.pdf`,
              meetingDate: dateStr,
              kind: "packet",
            });
          }
        }
        // Minutes post AFTER the meeting — typically 1-4 months later.
        for (let offset = 1; offset <= 4; offset++) {
          const upload = shiftMonth(y, m, offset);
          const base = `${PRIM_BASE}/wp-content/uploads/${upload.y}/${pad(upload.m)}`;
          out.push({
            url: `${base}/Board-Meeting-Minutes-${mmddyyyy}.pdf`,
            meetingDate: dateStr,
            kind: "minutes",
          });
        }
      }
    }
  }
  return out;
}

function everyThursdayOfMonth(year: number, month1Indexed: number): Date[] {
  const out: Date[] = [];
  const first = new Date(Date.UTC(year, month1Indexed - 1, 1));
  // Day 4 = Thursday in Date.getUTCDay() (0 = Sunday).
  const firstThursday = new Date(first);
  const diff = (4 - firstThursday.getUTCDay() + 7) % 7;
  firstThursday.setUTCDate(1 + diff);
  for (let d = new Date(firstThursday); d.getUTCMonth() === month1Indexed - 1; d.setUTCDate(d.getUTCDate() + 7)) {
    out.push(new Date(d));
  }
  return out;
}

function shiftMonth(year: number, month1Indexed: number, offset: number): { y: number; m: number } {
  const total = month1Indexed - 1 + offset;
  const y = year + Math.floor(total / 12);
  // Correct negative-offset wraparound (JS `%` preserves sign of dividend).
  const m = ((total % 12) + 12) % 12 + 1;
  return { y, m };
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
