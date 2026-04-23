import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  const { data: signals, error } = await supabase
    .from('signals')
    .select('id, confidence, priority_score, preliminary, plan:plans(name)')
    .limit(2000);

  if (error) {
    console.error('query failed:', error.message);
    process.exit(1);
  }
  if (!signals || signals.length === 0) {
    console.error('no signals returned');
    process.exit(1);
  }

  // Tier logic mirrors components/filters/filter-state.ts tierFor().
  function tierFor(confidence: number | null, priority: number | null, preliminary: boolean | null): 'accepted' | 'preliminary' | 'review' {
    const c = confidence ?? 0;
    const p = priority ?? 0;
    if (c < 0.70) return 'review';
    if (preliminary) return 'preliminary';
    if (c < 0.85) return 'preliminary';
    if (p < 40) return 'preliminary';
    return 'accepted';
  }

  console.log('=== Tier distribution (conf ≥ 0.85 AND priority ≥ 40 AND !preliminary → accepted) ===');
  const tiers: Record<string, number> = { accepted: 0, preliminary: 0, review: 0 };
  signals.forEach(s => {
    tiers[tierFor(s.confidence, s.priority_score, s.preliminary)]++;
  });
  Object.entries(tiers).forEach(([t, n]) => console.log(' ', t, ':', n));

  console.log('');
  console.log('=== Confidence distribution ===');
  let confNull = 0, confLo = 0, confMid = 0, confHi = 0;
  signals.forEach(s => {
    if (s.confidence == null) confNull++;
    else if (s.confidence < 0.70) confLo++;
    else if (s.confidence < 0.85) confMid++;
    else confHi++;
  });
  console.log('  null:', confNull);
  console.log('  < 0.70:', confLo);
  console.log('  0.70 - 0.85:', confMid);
  console.log('  ≥ 0.85:', confHi);

  console.log('');
  console.log('=== Priority score distribution ===');
  let priNull = 0, priZero = 0, priLow = 0, priHigh = 0;
  signals.forEach(s => {
    if (s.priority_score == null) priNull++;
    else if (s.priority_score === 0) priZero++;
    else if (s.priority_score < 40) priLow++;
    else priHigh++;
  });
  console.log('  null:', priNull);
  console.log('  0:', priZero);
  console.log('  1-39:', priLow);
  console.log('  ≥ 40:', priHigh);

  console.log('');
  console.log('=== preliminary column ===');
  let pTrue = 0, pFalse = 0;
  signals.forEach(s => {
    if (s.preliminary) pTrue++;
    else pFalse++;
  });
  console.log('  true:', pTrue);
  console.log('  false:', pFalse);

  console.log('');
  console.log('=== Sample 5 accepted signals ===');
  const accepted = signals.filter(s => tierFor(s.confidence, s.priority_score, s.preliminary) === 'accepted');
  accepted.slice(0, 5).forEach((s: any) =>
    console.log(' ', s.plan?.name ?? '(no plan)', '| conf:', s.confidence, '| priority:', s.priority_score, '| preliminary:', s.preliminary),
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
