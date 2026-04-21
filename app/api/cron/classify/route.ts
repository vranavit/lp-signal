import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phase 2 will implement the Claude vision classifier here.
// Stubbed in Phase 1 so the cron schedule can be declared up-front and
// pointed at a real endpoint.

export async function GET(_request: NextRequest) {
  return NextResponse.json({
    ok: true,
    phase: 1,
    note: "classifier is a Phase 2 build — this route is a placeholder",
  });
}
