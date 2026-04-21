import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runScraperForPlan } from "@/lib/scrapers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — Vercel Pro plan supports this

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  const header = request.headers.get("x-vercel-cron-secret");
  if (header && header === secret) return true;

  const query = request.nextUrl.searchParams.get("secret");
  if (query && query === secret) return true;

  // Vercel Cron adds this header on scheduled invocations. Only trust it when
  // Vercel-specific infra headers are also present to avoid spoofing in dev.
  if (request.headers.get("x-vercel-cron") === "1" && process.env.VERCEL) {
    return true;
  }

  return false;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();

  const { data: plans, error } = await supabase
    .from("plans")
    .select("id, name, scrape_config")
    .eq("active", true)
    .eq("country", "US")
    .filter("scrape_config->>key", "eq", "calpers"); // Phase 1 limits to CalPERS

  if (error) {
    return NextResponse.json(
      { error: "plans_query_failed", detail: error.message },
      { status: 500 },
    );
  }

  const results = [];
  for (const p of plans ?? []) {
    try {
      results.push(
        await runScraperForPlan(supabase, {
          id: p.id,
          name: p.name,
          scrape_config: p.scrape_config as Record<string, unknown> | null,
        }),
      );
    } catch (err) {
      results.push({
        plan: p.name,
        key: (p.scrape_config as { key?: string } | null)?.key ?? "unknown",
        pdfsFound: 0,
        inserted: 0,
        skipped: 0,
        errors: [
          {
            url: "",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      });
    }
  }

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    results,
  });
}
