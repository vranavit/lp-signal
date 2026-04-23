import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  computeContentHash,
  recordHash,
  type RecordHashInput,
} from "./change-detection";

/**
 * Shared helpers for per-source scrape cron endpoints.
 *
 * Each cron route imports `runScrapeCron` and a work function. The wrapper
 * handles auth, fingerprinting, error capture, and the JSON response.
 */

export function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const header = request.headers.get("x-vercel-cron-secret");
  if (header && header === secret) return true;
  const query = request.nextUrl.searchParams.get("secret");
  if (query && query === secret) return true;
  if (
    request.headers.get("x-vercel-cron") === "1" &&
    process.env.VERCEL
  ) {
    return true;
  }
  return false;
}

export type CronWorkResult = {
  // A stable-ish string the wrapper hashes to detect source-change. Pick
  // something that differs only when new work happened (e.g. sorted list
  // of inserted storage paths) so the fingerprint distinguishes quiet
  // days from productive ones.
  hashHint: string | null;
  inserted: number;
  skipped: number;
  errors: Array<{ url?: string; message: string }>;
  summary: string;
};

export type RunScrapeCronOptions = {
  sourceKey: string;
  expectedCadenceHours: number;
  work: () => Promise<CronWorkResult>;
};

export async function runScrapeCron(
  request: NextRequest,
  opts: RunScrapeCronOptions,
) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = createSupabaseAdminClient();
  const startedAt = new Date().toISOString();

  let result: CronWorkResult;
  let ok = true;
  let thrown: string | null = null;
  try {
    result = await opts.work();
    if (result.errors.length > 0) ok = false;
  } catch (err) {
    ok = false;
    thrown = err instanceof Error ? err.message : String(err);
    result = {
      hashHint: null,
      inserted: 0,
      skipped: 0,
      errors: [{ message: thrown ?? "unknown_error" }],
      summary: `threw: ${thrown}`,
    };
  }

  const hash = result.hashHint ? computeContentHash(result.hashHint) : null;
  // "Changed" when we inserted new docs OR the hashHint moved. First-ever
  // run with non-null hash also counts as changed.
  const existing = hash
    ? await supabase
        .from("scrape_fingerprints")
        .select("last_hash")
        .eq("source_key", opts.sourceKey)
        .maybeSingle()
    : null;
  const changed =
    result.inserted > 0 ||
    (hash != null && (existing?.data?.last_hash ?? null) !== hash);

  const payload: RecordHashInput = {
    hash,
    changed,
    ok,
    summary: result.summary.slice(0, 500),
    expectedCadenceHours: opts.expectedCadenceHours,
  };

  try {
    await recordHash(supabase, opts.sourceKey, payload);
  } catch (fpErr) {
    // Fingerprint failure shouldn't poison the cron response — the real
    // work completed (or not) already.
    console.warn(
      `[cron/${opts.sourceKey}] fingerprint write failed: ${fpErr instanceof Error ? fpErr.message : String(fpErr)}`,
    );
  }

  return NextResponse.json({
    ok,
    sourceKey: opts.sourceKey,
    startedAt,
    finishedAt: new Date().toISOString(),
    inserted: result.inserted,
    skipped: result.skipped,
    changed,
    errors: result.errors,
    summary: result.summary,
    ...(thrown ? { threw: thrown } : {}),
  });
}

/**
 * Convenience adapter for scrapers returning a `ScrapeResult`-ish shape
 * with { inserted, skipped, errors, pdfsFetched? } and an array of
 * inserted paths or urls. Produces a hashHint from the sorted list of
 * URLs that changed so the fingerprint distinguishes "nothing new" days
 * from "new docs arrived" days.
 */
export function summarizeStringList(urls: readonly string[]): string {
  return [...urls].sort().join("\n");
}
