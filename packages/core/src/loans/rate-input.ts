/**
 * A loan's interest rate as typed, and as stored.
 *
 * Stored it is always yearly basis points — what `monthlyRate` in the schedule divides by 12. A paylater quotes
 * its interest a month, so a monthly figure is stored as that × 12: "2" a month is 2400 bps, and the engine's
 * 2400 / 10000 / 12 gives back exactly the 2% a month that was typed.
 */
export type RatePer = 'month' | 'year';

/** The rate as typed ("9", "9,25", "2.95") to yearly basis points. Empty is no interest; a bad figure throws. */
export function rateBpsFromTyped(typed: string, per: RatePer = 'year'): number {
  const cleaned = typed.trim().replace(',', '.');
  if (cleaned === '') return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) throw new Error('The rate must be a number');
  return Math.round(value * 100 * (per === 'month' ? 12 : 1));
}

/** Yearly basis points as the form shows them, with a decimal comma and no trailing zeros; empty for zero. */
export function typedFromRateBps(rateBps: number, per: RatePer = 'year'): string {
  if (!(rateBps > 0)) return '';
  const value = per === 'month' ? rateBps / 12 / 100 : rateBps / 100;
  return Number(value.toFixed(per === 'month' ? 3 : 2)).toString().replace('.', ',');
}
