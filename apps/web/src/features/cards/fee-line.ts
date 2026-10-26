import { chargeAfterWaiver, dayMonth, FEE_SOON_DAYS, feeDaysAway, feeWaived, formatMinor, nextFeeDate } from '@expanses/core';

/** "12 Mar 2027". */
export const feeDateText = (iso: string) => `${dayMonth(iso)} ${iso.slice(0, 4)}`;

export interface FeeLine {
  /** The fee as money, when an amount is set. */
  amount: string | null;
  /** "Charged on 12 Mar 2027", or "Waived this year · next charge 12 Nov 2027"; null with no date. */
  when: string | null;
  /** The next charge is within the due-soon window and not waived. */
  soon: boolean;
  waived: boolean;
}

/** The annual fee row on a card's page; null while neither an amount nor a date is set. */
export function feeLine(
  feeMinor: number | null,
  chargedOn: string | null,
  waivedYear: number | null,
  currency: string,
  today: string,
): FeeLine | null {
  if (feeMinor === null && !chargedOn) return null;
  const amount = feeMinor !== null ? formatMinor(feeMinor, currency) : null;
  if (!chargedOn) return { amount, when: null, soon: false, waived: false };
  if (feeWaived(chargedOn, waivedYear, today)) {
    return { amount, when: `Waived this year · next charge ${feeDateText(chargeAfterWaiver(chargedOn, today))}`, soon: false, waived: true };
  }
  return { amount, when: `Charged on ${feeDateText(nextFeeDate(chargedOn, today))}`, soon: feeDaysAway(chargedOn, today) <= FEE_SOON_DAYS, waived: false };
}
