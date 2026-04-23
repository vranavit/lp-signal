import { createClient } from '@supabase/supabase-js';

// Three-way sanity check for how plans are visible to a service-role
// client: direct count, full select, and FK joins from signals and
// pension_allocations. Useful when debugging whether a particular
// query path is seeing the full plan set.

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  const { count, error: countErr } = await supabase
    .from('plans')
    .select('*', { count: 'exact', head: true });
  if (countErr) {
    console.error('plans count query failed:', countErr.message);
    process.exit(1);
  }
  console.log('Method 1 (plans count head): count =', count);

  const { data: allData, error: allErr } = await supabase
    .from('plans')
    .select('id, name, country, scrape_config, active');
  if (allErr) {
    console.error('plans full select failed:', allErr.message);
    process.exit(1);
  }
  console.log('Method 2 (plans select all): rows =', allData?.length ?? 0);

  const { data: sigData, error: sigErr } = await supabase
    .from('signals')
    .select('plan:plans(id, name)')
    .not('plan_id', 'is', null)
    .limit(200);
  if (sigErr) {
    console.error('signals-join query failed:', sigErr.message);
    process.exit(1);
  }
  const uniquePlans = new Map<string, { id: string; name: string }>();
  sigData?.forEach((s: any) => {
    if (s.plan) uniquePlans.set(s.plan.id, s.plan);
  });
  console.log('Method 3 (signals → plans join): unique plans found =', uniquePlans.size);
  uniquePlans.forEach(p => console.log(' ', p.name));

  const { data: allocData, error: allocErr } = await supabase
    .from('pension_allocations')
    .select('plan:plans(id, name)')
    .limit(200);
  if (allocErr) {
    console.error('allocations-join query failed:', allocErr.message);
    process.exit(1);
  }
  const uniqueAllocPlans = new Map<string, { id: string; name: string }>();
  allocData?.forEach((a: any) => {
    if (a.plan) uniqueAllocPlans.set(a.plan.id, a.plan);
  });
  console.log('');
  console.log('Method 4 (allocations → plans join): unique plans found =', uniqueAllocPlans.size);
  uniqueAllocPlans.forEach(p => console.log(' ', p.name));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
