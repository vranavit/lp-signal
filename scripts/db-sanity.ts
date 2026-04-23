import { createClient } from '@supabase/supabase-js';

async function main() {
  console.log('Connecting to:', process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log('');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  const tables = ['plans', 'signals', 'pension_allocations', 'documents', 'gps', 'allocation_policy_changes', 'firm_profiles'];

  for (const t of tables) {
    const { count, error } = await supabase
      .from(t)
      .select('*', { count: 'exact', head: true });
    if (error) {
      console.log(t, '→ ERROR:', error.message);
    } else {
      console.log(t, '→', count, 'rows');
    }
  }
}

main();
