import { createClient } from '@supabase/supabase-js';

// Session 2 spot-check — Oregon PERS + MA PRIM plan rows and any
// linked documents / processing status.

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  const { data: plans, error: planErr } = await supabase
    .from('plans')
    .select('id, name, country, aum_usd, scrape_config')
    .or('name.ilike.%oregon%,name.ilike.%prim%,name.ilike.%massachusetts%')
    .order('name');
  if (planErr) {
    console.error('plans query failed:', planErr.message);
    process.exit(1);
  }

  console.log('=== Plans matching oregon / prim / massachusetts ===');
  plans?.forEach(p => {
    const key = (p.scrape_config as { key?: string } | null)?.key ?? '(no key)';
    console.log(' ', p.id, '|', key, '|', p.name, '| AUM:', p.aum_usd);
  });

  const ids = plans?.map(p => p.id) ?? [];
  if (ids.length === 0) {
    console.log('No matching plans found.');
    return;
  }

  const { data: docs, error: docErr } = await supabase
    .from('documents')
    .select('plan_id, processing_status, source_url, created_at, error_message')
    .in('plan_id', ids)
    .order('created_at', { ascending: false });
  if (docErr) {
    console.error('documents query failed:', docErr.message);
    process.exit(1);
  }

  console.log('');
  console.log('=== Documents linked to those plans:', docs?.length ?? 0, '===');
  const statusCounts: Record<string, number> = {};
  docs?.forEach(d => {
    statusCounts[d.processing_status] = (statusCounts[d.processing_status] ?? 0) + 1;
  });
  Object.entries(statusCounts).forEach(([status, count]) => console.log(' ', status, ':', count));

  console.log('');
  console.log('=== Most recent 5 documents ===');
  docs?.slice(0, 5).forEach(d =>
    console.log(' ', d.processing_status, '|', (d.source_url ?? '').slice(-80), d.error_message ? `| err: ${d.error_message.slice(0, 60)}` : ''),
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
