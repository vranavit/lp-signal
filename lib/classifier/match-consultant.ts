import type { MasterListEntry } from "./prompts/consultants";

/**
 * Match an extracted firm name (e.g. "Aksia, LLC" / "AKSIA CA, LLC" /
 * "Stepstone Group, LP") against the canonical consultants master list.
 *
 * Used by:
 *   - scripts/test-consultant-classifier.ts (Block 2 validation harness)
 *   - scripts/backfill-consultants.ts (Block 3 production extraction)
 *
 * Both call resolveCanonicalEntry to look up the full master-list entry
 * (with id) when inserting plan_consultants rows; the harness uses the
 * thin resolveCanonicalName wrapper when only the display string matters.
 */

/**
 * Lowercase + strip common punctuation and corporate suffixes so
 * "Aksia, LLC" / "Aksia LLC" / "AKSIA L.L.C." all collapse to the same
 * comparable form.
 */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[,.\s]+/g, " ")
    .replace(
      /\b(llc|lp|l\.p\.|inc|inc\.|ltd|ltd\.|llp|company|partners)\b/g,
      "",
    )
    .trim();
}

/**
 * Resolve a name_as_written string to its master-list entry by checking
 * canonical_name + all name_aliases. Returns the full entry (with whatever
 * fields the caller supplied as T) or null on no match. Generic so the
 * backfill can pass a list with `id` alongside the standard
 * MasterListEntry fields.
 *
 * Match modes (in order):
 *   1. Exact match on normalized form -> return entry.
 *   2. Loose containment: target contains alias OR alias contains target,
 *      gated on alias length >= 4 chars to avoid spurious "Inc"/"LLC"
 *      hits. Catches "Aksia, LLC" matching "Aksia" and "Cambridge
 *      Associates" matching "Cambridge Associates LLC".
 */
export function resolveCanonicalEntry<T extends MasterListEntry>(
  nameAsWritten: string,
  masterList: T[],
): T | null {
  const targetNorm = normalizeForMatch(nameAsWritten);
  for (const entry of masterList) {
    const candidates = [entry.canonical_name, ...entry.name_aliases];
    for (const c of candidates) {
      const cNorm = normalizeForMatch(c);
      if (targetNorm === cNorm) return entry;
      if (
        cNorm.length >= 4 &&
        (targetNorm.includes(cNorm) || cNorm.includes(targetNorm))
      ) {
        return entry;
      }
    }
  }
  return null;
}

/**
 * Thin wrapper for callers that only need the display string. Forwards
 * to resolveCanonicalEntry and returns the canonical_name field.
 */
export function resolveCanonicalName(
  nameAsWritten: string,
  masterList: MasterListEntry[],
): string | null {
  return resolveCanonicalEntry(nameAsWritten, masterList)?.canonical_name ?? null;
}
