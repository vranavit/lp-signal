import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  const { data, error } = await supabase
    .from('plans')
    .select('id, name, country, aum_usd, tier, scrape_method, scrape_config, active, last_scraped_at')
    .order('name');

  if (error) {
    console.log('ERROR:', error.message);
    return;
  }

  console.log('Total plans:', data?.length ?? 0);
  console.log('');
  data?.forEach(p => {
    const key = (p.scrape_config as any)?.key ?? '(no key)';
    console.log(' ', p.name.padEnd(35), '|', key.padEnd(15), '| AUM:', (p.aum_usd/1e9).toFixed(0)+'B', '| tier:', p.tier, '| active:', p.active);
  });
}

main();
