import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  const { data: pensions } = await supabase
    .from('pensions')
    .select('id, slug, name, aum_usd')
    .order('slug');

  console.log('=== All pensions in DB ===');
  console.log('Total:', pensions?.length ?? 0);
  pensions?.forEach(p => console.log(' ', p.slug, '|', p.name, '| AUM:', p.aum_usd));
}

main();
