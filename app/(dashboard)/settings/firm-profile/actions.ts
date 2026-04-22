"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ASSET_CLASSES = ["PE", "Infra", "Credit", "RE", "VC"] as const;
const FUND_STAGES = ["emerging", "established", "flagship"] as const;
const GEO_OPTIONS = [
  "North America",
  "Europe",
  "Asia",
  "Rest of World",
] as const;

type AssetClass = (typeof ASSET_CLASSES)[number];
type FundStage = (typeof FUND_STAGES)[number];

function parseUsd(raw: FormDataEntryValue | null): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

export async function saveFirmProfile(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  const firmName = (formData.get("firm_name") as string | null)?.trim() || null;

  const assetClasses = formData
    .getAll("asset_class_focus")
    .map((v) => String(v))
    .filter((v): v is AssetClass =>
      (ASSET_CLASSES as readonly string[]).includes(v),
    );

  const fundStageRaw = formData.get("fund_stage");
  const fundStage =
    fundStageRaw && (FUND_STAGES as readonly string[]).includes(String(fundStageRaw))
      ? (fundStageRaw as FundStage)
      : null;

  const minUsd = parseUsd(formData.get("check_size_min_usd"));
  const maxUsd = parseUsd(formData.get("check_size_max_usd"));

  const geos = formData
    .getAll("geographic_focus")
    .map((v) => String(v))
    .filter((v) => (GEO_OPTIONS as readonly string[]).includes(v));

  const { error } = await supabase.from("firm_profiles").upsert(
    {
      user_id: user.id,
      firm_name: firmName,
      asset_class_focus: assetClasses,
      fund_stage: fundStage,
      check_size_min_usd: minUsd,
      check_size_max_usd: maxUsd,
      geographic_focus: geos,
    },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/firm-profile");
  return { ok: true };
}

export { ASSET_CLASSES, FUND_STAGES, GEO_OPTIONS };
