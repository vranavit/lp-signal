import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  const { data: plans, error } = await supabase
    .from('plans')
    .select('id, name, country, aum_usd, scrape_config, active')
    .order('name');
  if (error) {
    console.error('plans query failed:', error.message);
    process.exit(1);
  }

  console.log('=== All plans in DB ===');
  console.log('Total:', plans?.length ?? 0);
  plans?.forEach(p => {
    const key = (p.scrape_config as { key?: string } | null)?.key ?? '(no key)';
    const aum = p.aum_usd != null ? `${(Number(p.aum_usd) / 1e9).toFixed(0)}B` : '—';
    console.log(' ', key.padEnd(18), '|', p.name.padEnd(40), '| AUM:', aum, '| active:', p.active);
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
