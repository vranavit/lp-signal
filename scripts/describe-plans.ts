import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .limit(3);

  if (error) {
    console.log('ERROR:', error.message);
    return;
  }

  console.log('Total rows returned:', data?.length ?? 0);
  console.log('');
  if (data && data.length > 0) {
    console.log('=== Columns available on plans table ===');
    Object.keys(data[0]).forEach(k => console.log(' ', k));
    console.log('');
    console.log('=== First row (full) ===');
    console.log(JSON.stringify(data[0], null, 2));
  }
}

main();
