"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function requireUser() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthorized");
  return user;
}

function invalidate() {
  revalidatePath("/signals/review");
  revalidatePath("/signals");
}

export async function approveSignal(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("missing_id");

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("signals")
    .update({ validated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`approve_failed: ${error.message}`);

  invalidate();
}

export async function rejectSignal(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("missing_id");

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("signals").delete().eq("id", id);
  if (error) throw new Error(`reject_failed: ${error.message}`);

  invalidate();
}

export async function editAndApproveSignal(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const summary = String(formData.get("summary") ?? "").trim();
  const sourceQuote = String(formData.get("source_quote") ?? "").trim();
  const fieldsRaw = String(formData.get("fields") ?? "").trim();

  if (!id) throw new Error("missing_id");
  if (!summary) throw new Error("summary_required");

  let fields: Record<string, unknown>;
  try {
    const parsed = JSON.parse(fieldsRaw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("fields must be a JSON object");
    }
    fields = parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `invalid_fields_json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Keep commitment_amount_usd in sync if T1 fields.amount_usd changed.
  const patch: Record<string, unknown> = {
    summary,
    source_quote: sourceQuote || null,
    fields,
    validated_at: new Date().toISOString(),
  };
  if (typeof fields.amount_usd === "number") {
    patch.commitment_amount_usd = fields.amount_usd;
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("signals").update(patch).eq("id", id);
  if (error) throw new Error(`edit_failed: ${error.message}`);

  invalidate();
}
