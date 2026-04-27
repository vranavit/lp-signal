import type { CafrAdapter } from "./types";
import { nyscrfAdapter } from "./nyscrf";
import { njDoiAdapter } from "./nj_doi";
import { trsIllinoisAdapter } from "./trs_illinois";
import { minnesotaSbiAdapter } from "./minnesota_sbi";
import { maPrimAdapter } from "./ma_prim";

export type { CafrAdapter, CafrCandidate } from "./types";
export {
  MAX_FYE_AGE_MONTHS,
  MAX_PROBES_PER_RUN,
  isFyeWithinRecencyWindow,
} from "./types";

/**
 * Wave 1 CAFR auto-ingest adapter registry. Keys must match
 * plans.scrape_config.key. Wave 2 adapters register here too once
 * they land.
 */
export const CAFR_ADAPTERS: Record<string, CafrAdapter> = {
  nyscrf: nyscrfAdapter,
  nj_doi: njDoiAdapter,
  trs_illinois: trsIllinoisAdapter,
  minnesota_sbi: minnesotaSbiAdapter,
  ma_prim: maPrimAdapter,
};

export function getAdapterForPlanKey(key: string): CafrAdapter | undefined {
  return CAFR_ADAPTERS[key];
}
