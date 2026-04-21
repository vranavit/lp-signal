// Deterministic priority-score computation. Per spec §2:
//   score = type_base + size_mult + recency_mult + plan_tier_mult
// Computed in code (not model) so it is reproducible, auditable, and does
// not waste tokens asking Claude to guess plan AUM or clock time.

export type ScoreInputs = {
  type: 1 | 2 | 3;
  amount_usd: number | null;
  plan_tier: number | null; // 1 | 2 | 3 from plans.tier
  meeting_date: string | null; // ISO date
};

export function computePriorityScore(i: ScoreInputs): number {
  const base = i.type === 1 ? 40 : i.type === 2 ? 25 : 10;
  const score =
    base +
    sizeMultiplier(i.amount_usd) +
    recencyMultiplier(i.meeting_date) +
    tierMultiplier(i.plan_tier);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function sizeMultiplier(amount: number | null): number {
  if (!amount || amount <= 0) return 0;
  if (amount >= 1_000_000_000) return 30;
  if (amount >= 500_000_000) return 25;
  if (amount >= 250_000_000) return 20;
  if (amount >= 100_000_000) return 15;
  if (amount >= 50_000_000) return 10;
  if (amount >= 25_000_000) return 5;
  return 2;
}

function recencyMultiplier(date: string | null): number {
  if (!date) return 5;
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return 5;
  const days = (Date.now() - t) / 86_400_000;
  if (days < 0) return 10;
  if (days <= 7) return 15;
  if (days <= 30) return 12;
  if (days <= 90) return 8;
  if (days <= 180) return 4;
  return 0;
}

function tierMultiplier(tier: number | null): number {
  if (tier === 1) return 15;
  if (tier === 2) return 10;
  if (tier === 3) return 5;
  return 0;
}
