import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function main() {
  const s = createSupabaseAdminClient();

  const counts = async (table: string, filters: Array<[string, unknown]> = []) => {
    let q = s.from(table).select("id", { count: "exact", head: true });
    for (const [k, v] of filters) q = q.eq(k, v);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  };

  const total = await counts("signals");
  const seed = await counts("signals", [["seed_data", true]]);
  const live = await counts("signals", [["seed_data", false]]);
  const t1 = await counts("signals", [["seed_data", false], ["signal_type", 1]]);
  const t2 = await counts("signals", [["seed_data", false], ["signal_type", 2]]);
  const t3 = await counts("signals", [["seed_data", false], ["signal_type", 3]]);
  const prelim = await counts("signals", [["preliminary", true]]);
  const rej = await counts("rejected_signals");
  const rejV22 = await counts("rejected_signals", [
    ["rejection_reason", "v22_retroactive"],
  ]);

  console.log(`signals total: ${total} (seed: ${seed}, live: ${live})`);
  console.log(`live breakdown: T1=${t1} T2=${t2} T3=${t3}`);
  console.log(`preliminary: ${prelim}`);
  console.log(`rejected_signals total: ${rej} (v22_retroactive: ${rejV22})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
