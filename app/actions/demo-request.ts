"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Cheap input-shape email check. Anything obviously bogus gets rejected so
// the row isn't polluted with junk. Real verification happens when Vitek
// follows up.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type DemoRequestResult =
  | { ok: true }
  | { ok: false; error: string };

export async function submitDemoRequest(
  formData: FormData,
): Promise<DemoRequestResult> {
  const raw = String(formData.get("email") ?? "").trim();
  if (!raw) return { ok: false, error: "Please enter your work email." };
  if (!EMAIL_RE.test(raw) || raw.length > 254) {
    return { ok: false, error: "That doesn't look like a valid email." };
  }

  // Hash client IP so we don't store the raw value but can still dedup.
  const ipHash = (() => {
    try {
      const h = headers();
      const fwd = h.get("x-forwarded-for") ?? "";
      const ip = fwd.split(",")[0]?.trim() || h.get("x-real-ip") || "";
      if (!ip) return null;
      return createHash("sha256").update(ip).digest("hex").slice(0, 32);
    } catch {
      return null;
    }
  })();

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("demo_requests").insert({
    email: raw.toLowerCase(),
    source: "landing_page",
    ip_hash: ipHash,
  });
  if (error) return { ok: false, error: "Server error. Try again in a minute." };
  return { ok: true };
}
