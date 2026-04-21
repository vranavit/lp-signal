import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { classifyDocument } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — Vercel Pro

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  const header = request.headers.get("x-vercel-cron-secret");
  if (header && header === secret) return true;

  const query = request.nextUrl.searchParams.get("secret");
  if (query && query === secret) return true;

  if (request.headers.get("x-vercel-cron") === "1" && process.env.VERCEL) {
    return true;
  }

  return false;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "missing_anthropic_api_key" },
      { status: 500 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.max(1, Math.min(50, Number(limitParam ?? "10") || 10));

  const { data: pending, error } = await supabase
    .from("documents")
    .select("id")
    .eq("processing_status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: "pending_query_failed", detail: error.message },
      { status: 500 },
    );
  }

  const results = [];
  for (const d of pending ?? []) {
    results.push(await classifyDocument(supabase, d.id));
  }

  const signalsInserted = results.reduce((a, r) => a + r.signalsInserted, 0);
  const signalsExtracted = results.reduce((a, r) => a + r.signalsExtracted, 0);
  const tokensUsed = results.reduce((a, r) => a + r.tokensUsed, 0);
  const okCount = results.filter((r) => r.ok).length;

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    processed: results.length,
    succeeded: okCount,
    failed: results.length - okCount,
    signalsExtracted,
    signalsInserted,
    tokensUsed,
    results,
  });
}
