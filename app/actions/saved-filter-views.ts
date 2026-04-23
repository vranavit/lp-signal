"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FilterState } from "@/components/filters/filter-state";

// End-user CRUD for saved_filter_views. Uses the user-scoped Supabase
// client so RLS does the authorization — no auth.uid() juggling here.
//
// Shape returned to the UI is stable across additive filter-state changes:
// filter_json is stored as-is and parsed on the client. If we add a field
// later, older saved views hydrate with defaults for the missing keys.

export type SavedView = {
  id: string;
  name: string;
  page: "outreach" | "signals";
  filter_json: FilterState;
  created_at: string;
};

export type SavedViewsResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function listSavedViews(
  page: "outreach" | "signals",
): Promise<SavedViewsResult<SavedView[]>> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const { data, error } = await supabase
    .from("saved_filter_views")
    .select("id, name, page, filter_json, created_at")
    .eq("user_id", user.id)
    .eq("page", page)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    // Surface the message up — the UI shows it inline so the developer
    // realizes the migration hasn't been applied.
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    data: (data ?? []) as unknown as SavedView[],
  };
}

export async function createSavedView(input: {
  name: string;
  page: "outreach" | "signals";
  filter_json: FilterState;
}): Promise<SavedViewsResult<SavedView>> {
  const trimmed = input.name.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };
  if (trimmed.length > 80) return { ok: false, error: "Name too long (max 80 chars)." };
  if (input.page !== "outreach" && input.page !== "signals") {
    return { ok: false, error: "Invalid page." };
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const { data, error } = await supabase
    .from("saved_filter_views")
    .insert({
      user_id: user.id,
      name: trimmed,
      page: input.page,
      filter_json: input.filter_json,
    })
    .select("id, name, page, filter_json, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "You already have a view with that name on this page.",
      };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, data: data as unknown as SavedView };
}

export async function deleteSavedView(
  id: string,
): Promise<SavedViewsResult<null>> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const { error } = await supabase
    .from("saved_filter_views")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
