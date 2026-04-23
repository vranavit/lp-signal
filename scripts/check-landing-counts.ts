import { createClient } from '@supabase/supabase-js';

// Diagnostic for the landing-page "pensions monitored" counter in
// app/page.tsx loadLiveStats(). Prints the three candidate denominators
// (signals-only / allocations-only / union) plus the accepted-tier count
// using the real tierFor() criteria.

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  // Plans with any signals (validated, non-seed, plan_id set).
  const { data: plansWithSignals, error: sigErr } = await supabase
    .from('signals')
    .select('plan_id, plan:plans(name)')
    .eq('seed_data', false)
    .not('validated_at', 'is', null)
    .not('plan_id', 'is', null);
  if (sigErr) {
    console.error('signals query failed:', sigErr.message);
    process.exit(1);
  }
  const uniqSignal = new Set((plansWithSignals ?? []).map((s: any) => s.plan?.name).filter(Boolean));
  console.log('Plans with validated signals:', uniqSignal.size);
  uniqSignal.forEach(n => console.log(' ', n));

  // Accepted-tier plans (conf ≥ 0.85 AND priority ≥ 40 AND !preliminary).
  const { data: accepted, error: accErr } = await supabase
    .from('signals')
    .select('plan_id, plan:plans(name), confidence, priority_score, preliminary')
    .eq('seed_data', false)
    .not('validated_at', 'is', null)
    .not('plan_id', 'is', null)
    .gte('confidence', 0.85);
  if (accErr) {
    console.error('accepted-signals query failed:', accErr.message);
    process.exit(1);
  }
  const uniqAccepted = new Set(
    (accepted ?? [])
      .filter((s: any) => !s.preliminary && (s.priority_score ?? 0) >= 40)
      .map((s: any) => s.plan?.name)
      .filter(Boolean),
  );
  console.log('');
  console.log('Plans with ACCEPTED signals (conf ≥ 0.85 AND priority ≥ 40 AND !preliminary):', uniqAccepted.size);
  uniqAccepted.forEach(n => console.log(' ', n));

  // Plans with allocations.
  const { data: plansWithAllocs, error: allocErr } = await supabase
    .from('pension_allocations')
    .select('plan_id, plan:plans(name)');
  if (allocErr) {
    console.error('allocations query failed:', allocErr.message);
    process.exit(1);
  }
  const uniqAlloc = new Set((plansWithAllocs ?? []).map((a: any) => a.plan?.name).filter(Boolean));
  console.log('');
  console.log('Plans with allocation data:', uniqAlloc.size);
  uniqAlloc.forEach(n => console.log(' ', n));

  // Union — the figure the landing hero now uses.
  const union = new Set<string>([...uniqSignal, ...uniqAlloc]);
  console.log('');
  console.log('UNION (signals ∪ allocations) — what the hero renders:', union.size);

  // Active plans — the authoritative roster.
  const { data: activePlans, error: planErr } = await supabase
    .from('plans')
    .select('id, name', { count: 'exact' })
    .eq('active', true);
  if (planErr) {
    console.error('plans query failed:', planErr.message);
    process.exit(1);
  }
  console.log('');
  console.log('Active plans (roster):', activePlans?.length ?? 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
