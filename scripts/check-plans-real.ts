import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  // plans table has no `slug` column. The per-plan identifier lives in
  // scrape_config.key (see lib/plans/data-availability.ts).
  const { data, count, error } = await supabase
    .from('plans')
    .select('id, name, country, aum_usd, tier, active, scrape_config', { count: 'exact' })
    .order('name');

  if (error) {
    console.error('query failed:', error.message);
    process.exit(1);
  }

  console.log('Total plans:', count);
  data?.forEach(p => {
    const key = (p.scrape_config as { key?: string } | null)?.key ?? '(no key)';
    const aum = p.aum_usd != null ? `${(Number(p.aum_usd) / 1e9).toFixed(0)}B` : '—';
    console.log(
      ' ',
      p.name.padEnd(40),
      '|',
      key.padEnd(18),
      '| AUM:',
      aum.padStart(6),
      '| tier:',
      p.tier ?? '—',
      '| country:',
      p.country,
      '| active:',
      p.active,
    );
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
