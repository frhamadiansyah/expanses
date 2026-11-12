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
  waived: boolean;
  /** This year's charge was refunded by the bank (a fee challenge met). */
  refunded: boolean;
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
  if (!chargedOn) return { amount, when: null, soon: false, waived: false, refunded: false };
  if (refundedYear !== null && refundedYear === Number(coveredCharge(chargedOn, today).slice(0, 4))) {
    return { amount, when: `Refunded this year · next charge ${feeDateText(chargeAfterWaiver(chargedOn, today))}`, soon: false, waived: false, refunded: true };
  }
  if (feeWaived(chargedOn, waivedYear, today)) {
    return { amount, when: `Waived this year · next charge ${feeDateText(chargeAfterWaiver(chargedOn, today))}`, soon: false, waived: true, refunded: false };
  }
  // The charge that counts is the one that already happened unless the next is close: then that one is named.
  const covered = coveredCharge(chargedOn, today);
  const next = nextFeeDate(chargedOn, today);
  const when = covered < today ? `Charged on ${feeDateText(covered)} · next ${feeDateText(next)}` : `Charged on ${feeDateText(next)}`;
  return { amount, when, soon: feeDaysAway(chargedOn, today) <= FEE_SOON_DAYS, waived: false, refunded: false };
}
