import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
  const { data, error } = await supabase
    .from('allocation_policy_changes')
    .select('*')
    .order('detected_at', { ascending: false });

  if (error) {
    console.error('Error:', error);
    return;
  }
  console.log('Total rows:', data?.length ?? 0);
  data?.forEach(r => {
    console.log(
      r.plan_id,
      r.asset_class,
      r.previous_target_pct,
      '->',
      r.new_target_pct,
      r.detected_at
    );
  });
}

main();
