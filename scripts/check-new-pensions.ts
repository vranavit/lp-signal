import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  const { data: pensions } = await supabase
    .from('pensions')
    .select('id, slug, name, aum_usd, country')
    .or('slug.ilike.%oregon%,slug.ilike.%prim%,slug.ilike.%mass%')
    .order('slug');

  console.log('=== Pensions matching oregon/prim/mass ===');
  pensions?.forEach(p => console.log(' ', p.id, '|', p.slug, '|', p.name, '| AUM:', p.aum_usd));

  const ids = pensions?.map(p => p.id) ?? [];
  if (ids.length === 0) {
    console.log('No matching pensions found.');
    return;
  }

  const { data: docs } = await supabase
    .from('documents')
    .select('plan_id, processing_status, source_url, created_at')
    .in('plan_id', ids)
    .order('created_at', { ascending: false });

  console.log('');
  console.log('=== Documents linked to those pensions:', docs?.length ?? 0, '===');
  const statusCounts: Record<string, number> = {};
  docs?.forEach(d => {
    statusCounts[d.processing_status] = (statusCounts[d.processing_status] ?? 0) + 1;
  });
  Object.entries(statusCounts).forEach(([status, count]) => console.log(' ', status, ':', count));

  console.log('');
  console.log('=== Most recent 5 documents ===');
  docs?.slice(0, 5).forEach(d => console.log(' ', d.processing_status, '|', d.source_url?.slice(-80)));
}

main();
