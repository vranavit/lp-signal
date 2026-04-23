import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  // First, fetch the row we intend to delete so we see exactly what we're removing
  const { data: before, error: fetchErr } = await supabase
    .from('allocation_policy_changes')
    .select('*')
    .eq('plan_id', '1d9fcceb-07df-4026-8f91-bd886346d628')
    .eq('asset_class', 'Other');

  if (fetchErr) {
    console.error('Fetch error:', fetchErr);
    return;
  }

  console.log('About to delete', before?.length ?? 0, 'row(s):');
  before?.forEach(r => console.log('  ', r.asset_class, r.previous_target_pct, '->', r.new_target_pct, 'detected', r.detected_at));

  if (!before || before.length === 0) {
    console.log('Nothing to delete. Exiting.');
    return;
  }

  if (before.length > 1) {
    console.error('ABORT: More than one row matches. Refusing to delete to avoid accidents.');
    return;
  }

  // Delete the one matching row
  const { error: deleteErr } = await supabase
    .from('allocation_policy_changes')
    .delete()
    .eq('plan_id', '1d9fcceb-07df-4026-8f91-bd886346d628')
    .eq('asset_class', 'Other');

  if (deleteErr) {
    console.error('Delete error:', deleteErr);
    return;
  }

  // Verify final state
  const { data: after, error: afterErr } = await supabase
    .from('allocation_policy_changes')
    .select('*')
    .order('detected_at', { ascending: false });

  if (afterErr) {
    console.error('Final check error:', afterErr);
    return;
  }

  console.log('');
  console.log('Delete complete. Remaining rows:', after?.length ?? 0);
  after?.forEach(r => console.log('  ', r.asset_class, r.previous_target_pct, '->', r.new_target_pct));
}

main();
