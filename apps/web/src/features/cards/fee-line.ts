import { chargeAfterWaiver, coveredCharge, dayMonth, FEE_SOON_DAYS, feeDaysAway, feeWaived, formatMinor, nextFeeDate } from '@expanses/core';

/** "12 Mar 2027". */
export const feeDateText = (iso: string) => `${dayMonth(iso)} ${iso.slice(0, 4)}`;

export interface FeeLine {
  /** The fee as money, when an amount is set. */
  amount: string | null;
  /** "Charged on 12 Mar 2026 · next 12 Mar 2027" (or just "Charged on <date>" when the next is soon), or "Waived this year · next charge 12 Nov 2027"; null with no date. */
  when: string | null;
  /** The next charge is within the due-soon window and not waived. */
  soon: boolean;
  /** This year's charge was waived: marked so, or refunded through the old Fee refunded (one word for both now). */
  waived: boolean;
}

/** The annual fee row on a card's page; null while neither an amount nor a date is set. */
export function feeLine(
  feeMinor: number | null,
  chargedOn: string | null,
  waivedYear: number | null,
  currency: string,
  today: string,
  refundedYear: number | null = null,
): FeeLine | null {
  if (feeMinor === null && !chargedOn) return null;
  const amount = feeMinor !== null ? formatMinor(feeMinor, currency) : null;
  if (!chargedOn) return { amount, when: null, soon: false, waived: false };
  const refunded = refundedYear !== null && refundedYear === Number(coveredCharge(chargedOn, today).slice(0, 4));
  if (refunded || feeWaived(chargedOn, waivedYear, today)) {
    return { amount, when: `Waived this year · next charge ${feeDateText(chargeAfterWaiver(chargedOn, today))}`, soon: false, waived: true };
  }
  // The charge that counts is the one that already happened unless the next is close: then that one is named.
  const covered = coveredCharge(chargedOn, today);
  const next = nextFeeDate(chargedOn, today);
  const when = covered < today ? `Charged on ${feeDateText(covered)} · next ${feeDateText(next)}` : `Charged on ${feeDateText(next)}`;
  return { amount, when, soon: feeDaysAway(chargedOn, today) <= FEE_SOON_DAYS, waived: false };
}

/**
 * Whether a fee challenge is about the fee year a waiver covers now: the year kept on the challenge when it was saved
 * (the charge it was given for, even when given after the fee posted) is the covered charge's. Only such a challenge
 * offers Fee waived or says the fee was waived; last year's reads as ended, and next year's shows its own progress.
 */
export function challengeCoversFee(challengeYear: number | null, coveredYear: number): boolean {
  return challengeYear !== null && challengeYear === coveredYear;
}
