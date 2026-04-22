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

// Confirm a preliminary signal: clear the flag so it shows up in the main
// dashboard without the "preliminary" caveat.
export async function confirmPreliminary(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("missing_id");

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("signals")
    .update({ preliminary: false })
    .eq("id", id);
  if (error) throw new Error(`confirm_failed: ${error.message}`);

  invalidate();
}

// Reject a preliminary signal: move it to rejected_signals (with reason
// "operator_reject") and delete it from signals. Wrapped in an admin-client
// sequence — we don't have cross-table transactions here, so on insert
// failure we abort before deleting.
export async function rejectPreliminary(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("missing_id");

  const admin = createSupabaseAdminClient();

  const { data: row, error: fetchErr } = await admin
    .from("signals")
    .select(
      "id, document_id, plan_id, signal_type, confidence, asset_class, summary, fields, source_page, source_quote, prompt_version",
    )
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) throw new Error(`reject_fetch_failed: ${fetchErr.message}`);
  if (!row) throw new Error("signal_not_found");

  const { error: insErr } = await admin.from("rejected_signals").insert({
    document_id: row.document_id,
    plan_id: row.plan_id,
    signal_type: row.signal_type,
    confidence: row.confidence,
    asset_class: row.asset_class,
    summary: row.summary,
    fields: row.fields,
    source_page: row.source_page,
    source_quote: row.source_quote,
    rejection_reason: "operator_reject",
    prompt_version: row.prompt_version,
  });
  if (insErr) throw new Error(`reject_insert_failed: ${insErr.message}`);

  const { error: delErr } = await admin.from("signals").delete().eq("id", id);
  if (delErr) throw new Error(`reject_delete_failed: ${delErr.message}`);

  invalidate();
}

// Edit a preliminary signal inline and confirm it in one action.
export async function editAndConfirmPreliminary(formData: FormData) {
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

  const patch: Record<string, unknown> = {
    summary,
    source_quote: sourceQuote || null,
    fields,
    preliminary: false,
  };
  if (typeof fields.amount_usd === "number") {
    patch.commitment_amount_usd = fields.amount_usd;
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("signals").update(patch).eq("id", id);
  if (error) throw new Error(`edit_failed: ${error.message}`);

  invalidate();
}
