import type { CafrAdapter } from "./types";
import { nyscrfAdapter } from "./nyscrf";
import { njDoiAdapter } from "./nj_doi";
import { trsIllinoisAdapter } from "./trs_illinois";
import { minnesotaSbiAdapter } from "./minnesota_sbi";
import { maPrimAdapter } from "./ma_prim";
import { calpersAdapter } from "./calpers";
import { ohioPersAdapter } from "./ohio_pers";
import { paPsersAdapter } from "./pa_psers";
import { laceraAdapter } from "./lacera";
import { oregonPersAdapter } from "./oregon_pers";
import { vrsAdapter } from "./vrs";
import { michiganAdapter } from "./michigan";
import { ncRetirementAdapter } from "./nc_retirement";
import { wsibAdapter } from "./wsib";

export type { CafrAdapter, CafrCandidate } from "./types";
export {
  MAX_FYE_AGE_MONTHS,
  MAX_PROBES_PER_RUN,
  isFyeWithinRecencyWindow,
} from "./types";

/**
 * CAFR auto-ingest adapter registry. Keys must match
 * plans.scrape_config.key.
 *
 * Wave 1 (PR 2, 5 adapters): nyscrf, nj_doi, trs_illinois,
 *   minnesota_sbi, ma_prim.
 * Wave 2a (PR 3, 9 adapters): calpers, ohio_pers, pa_psers, lacera,
 *   oregon_pers, vrs (single year-encoded); michigan (WordPress
 *   publish-folder); nc_retirement, wsib (quarterly snapshot).
 * Wave 2b (PR 3.5, deferred): calstrs (HTML-scrape adapter shape
 *   not yet built).
 */
export const CAFR_ADAPTERS: Record<string, CafrAdapter> = {
  // Wave 1
  nyscrf: nyscrfAdapter,
  nj_doi: njDoiAdapter,
  trs_illinois: trsIllinoisAdapter,
  minnesota_sbi: minnesotaSbiAdapter,
  ma_prim: maPrimAdapter,
  // Wave 2a - single year-encoded
  calpers: calpersAdapter,
  ohio_pers: ohioPersAdapter,
  pa_psers: paPsersAdapter,
  lacera: laceraAdapter,
  oregon_pers: oregonPersAdapter,
  vrs: vrsAdapter,
  // Wave 2a - WordPress publish-folder
  michigan: michiganAdapter,
  // Wave 2a - quarterly snapshot
  nc_retirement: ncRetirementAdapter,
  wsib: wsibAdapter,
};

export function getAdapterForPlanKey(key: string): CafrAdapter | undefined {
  return CAFR_ADAPTERS[key];
}
