import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  const { count: plansCount } = await supabase.from('plans').select('*', { count: 'exact', head: true });
  const { count: signalsCount } = await supabase.from('signals').select('*', { count: 'exact', head: true });
  const { count: docsCount } = await supabase.from('documents').select('*', { count: 'exact', head: true });

  console.log('=== Overall counts ===');
  console.log('Plans:', plansCount);
  console.log('Signals:', signalsCount);
  console.log('Documents:', docsCount);
  console.log('');

  // Signals grouped by plan
  const { data: signals } = await supabase
    .from('signals')
    .select('plan_id, plan:plans(name)')
    .not('plan_id', 'is', null);

  const byPlan: Record<string, number> = {};
  signals?.forEach((s: any) => {
    const name = s.plan?.name ?? 'Unknown';
    byPlan[name] = (byPlan[name] ?? 0) + 1;
  });

  console.log('=== Signals per plan ===');
  Object.entries(byPlan)
    .sort(([, a], [, b]) => b - a)
    .forEach(([name, count]) => console.log(' ', name.padEnd(40), count));
}

main();
