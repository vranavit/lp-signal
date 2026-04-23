import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  // Method 1: direct count (the one that returned null)
  const { data: countData, count, error: countErr } = await supabase
    .from('pensions')
    .select('*', { count: 'exact', head: true });
  console.log('Method 1 (count head): count=', count, 'data=', countData, 'err=', countErr?.message);

  // Method 2: select all, no head
  const { data: allData, error: allErr } = await supabase
    .from('pensions')
    .select('*');
  console.log('Method 2 (select all): rows=', allData?.length ?? 0, 'err=', allErr?.message);

  // Method 3: via foreign key from signals
  const { data: sigData, error: sigErr } = await supabase
    .from('signals')
    .select('plan:plans(id, slug, name)')
    .not('plan_id', 'is', null)
    .limit(20);
  
  const uniquePlans = new Map<string, any>();
  sigData?.forEach((s: any) => {
    if (s.plan) uniquePlans.set(s.plan.id, s.plan);
  });
  console.log('Method 3 (via signals join): unique plans found=', uniquePlans.size);
  uniquePlans.forEach(p => console.log(' ', p.slug, '|', p.name));

  // Method 4: via foreign key from pension_allocations
  const { data: allocData } = await supabase
    .from('pension_allocations')
    .select('plan:plans(id, slug, name)')
    .limit(20);
  const uniqueAllocPlans = new Map<string, any>();
  allocData?.forEach((a: any) => {
    if (a.plan) uniqueAllocPlans.set(a.plan.id, a.plan);
  });
  console.log('');
  console.log('Method 4 (via allocations join): unique plans found=', uniqueAllocPlans.size);
  uniqueAllocPlans.forEach(p => console.log(' ', p.slug, '|', p.name));
}

main();
