/**
 * Dry-run probe for the Wave 1 CAFR adapters.
 *
 * For each adapter in the registry, calls candidateUrls(new Date()), then
 * HEAD-probes each candidate URL and prints status + content-type + size.
 * Mimics the PR 4 dispatcher: stops probing per-adapter at the first 200
 * + application/pdf (cap-1 per run) and applies the MAX_FYE_AGE_MONTHS
 * recency filter. Does NOT call ingestCafr() or write to the DB.
 *
 * Usage: pnpm tsx scripts/test-cafr-adapters.ts
 */

import {
  CAFR_ADAPTERS,
  MAX_FYE_AGE_MONTHS,
  MAX_PROBES_PER_RUN,
  isFyeWithinRecencyWindow,
} from "@/lib/scrapers/cafr-adapters";
import { fetchWithDefaults } from "@/lib/scrapers/http";

type ProbeResult = {
  status: number | null;
  contentType: string | null;
  contentLength: number | null;
  error: string | null;
};

async function probe(url: string): Promise<ProbeResult> {
  try {
    const res = await fetchWithDefaults(url, { method: "HEAD" });
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentLength: parseContentLength(res.headers.get("content-length")),
      error: null,
    };
  } catch (e) {
    return {
      status: null,
      contentType: null,
      contentLength: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function parseContentLength(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - MAX_FYE_AGE_MONTHS);

  console.log("=== CAFR ADAPTER DRY-RUN ===");
  console.log(`today: ${today.toISOString()}`);
  console.log(
    `MAX_FYE_AGE_MONTHS: ${MAX_FYE_AGE_MONTHS} (cutoff: ${cutoff.toISOString().slice(0, 10)})`,
  );
  console.log(`MAX_PROBES_PER_RUN: ${MAX_PROBES_PER_RUN}`);
  console.log("");

  for (const [key, adapter] of Object.entries(CAFR_ADAPTERS)) {
    const candidates = adapter.candidateUrls(today);
    console.log(`--- ${key} ---`);
    console.log(`candidates: ${candidates.length}`);

    let wouldIngest: { url: string; fiscalYearEnd: string } | null = null;
    let anyRecencyPass = false;
    let probedCount = 0;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const recencyPass = isFyeWithinRecencyWindow(c.fiscalYearEnd, today);
      if (recencyPass) anyRecencyPass = true;
      const recencyTag = recencyPass ? "pass" : "FILTERED (>24mo)";

      let probeStr = "";
      if (recencyPass && !wouldIngest && probedCount < MAX_PROBES_PER_RUN) {
        probedCount++;
        const r = await probe(c.url);
        if (r.error) {
          probeStr = ` | HEAD: ERROR ${r.error}`;
        } else {
          const ct = r.contentType ?? "—";
          probeStr = ` | HEAD: ${r.status} | ct: ${ct} | size: ${formatBytes(r.contentLength)}`;
          if (r.status === 200 && ct.toLowerCase().includes("pdf")) {
            wouldIngest = { url: c.url, fiscalYearEnd: c.fiscalYearEnd };
          }
        }
      }

      console.log(`  [${i + 1}] FYE ${c.fiscalYearEnd}`);
      console.log(`      ${c.url}`);
      console.log(`      RECENCY: ${recencyTag}${probeStr}`);
    }

    if (candidates.length === 0) {
      console.log("result: NO CANDIDATES EMITTED (all FYs in future)");
    } else if (!anyRecencyPass) {
      console.log("result: ALL CANDIDATES OLDER THAN 24 MONTHS (filter rejected all)");
    } else if (wouldIngest) {
      console.log(
        `result: WOULD INGEST -> ${wouldIngest.url} (FY ${wouldIngest.fiscalYearEnd})`,
      );
    } else {
      console.log("result: NO CANDIDATE FOUND (all probes 404 / non-PDF / error)");
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
