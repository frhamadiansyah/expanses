import { challengeCoversFee, dayMonth, type FeeYearLine, formatMinor } from '@expanses/core';
import type { FeeYearRecord } from '@expanses/db';
import { shortMoney } from '../networth/value-chart';

/** "12 Mar 2027". */
export const feeDateText = (iso: string) => `${dayMonth(iso)} ${iso.slice(0, 4)}`;

/** Whether a fee challenge is about the fee year a waiver covers now (core's rule, kept here for the card's pages). */
export { challengeCoversFee };

/** A fee line's date: "15 Oct" in the fee year the line is about, "2 Feb 2027" in any other. */
export const lineDate = (iso: string, feeYear: number) => (Number(iso.slice(0, 4)) === feeYear ? dayMonth(iso) : feeDateText(iso));

/** One line of a fee year: `Title  value`, and the transaction it opens, if any. */
export interface FeeRow {
  kind: FeeYearLine;
  title: string;
  value: string;
  transactionId: string | null;
}

/**
 * A fee year's lines on the Fee waiver page, top first, as plain values: the charge or Pending/Waived with the card's
 * fee, then the reversal. `fullDates` keeps every date's year (a past year's own page).
 */
export function feeRows(record: FeeYearRecord, feeMinor: number | null, currency: string, fullDates = false): FeeRow[] {
  const date = (iso: string) => (fullDates ? feeDateText(iso) : lineDate(iso, record.year));
  const fee = feeMinor !== null ? formatMinor(feeMinor, currency) : null;
  const withFee = (head: string) => (fee ? `${head} · ${fee}` : head);
  return record.lines.map((kind): FeeRow => {
    if (kind === 'charged' && record.charge) return { kind, title: 'Charged', value: `${date(record.charge.on)} · ${formatMinor(record.charge.amountMinor, currency)}`, transactionId: record.charge.transactionId };
    // Charged before the app reads as any charge, with the card's fee (owner, 22 Nov 2026), or just its date with no fee set.
    if (kind === 'charged-before-app') return { kind, title: 'Charged', value: withFee(date(record.covered)), transactionId: null };
    if (kind === 'reversal' && record.reversal) return { kind, title: 'Reversal', value: `${date(record.reversal.on)} · ${formatMinor(record.reversal.amountMinor, currency)}`, transactionId: record.reversal.transactionId };
    if (kind === 'waived') return { kind, title: 'Waived', value: withFee('not charged'), transactionId: null };
    return { kind: 'pending', title: 'Pending', value: withFee(date(record.covered)), transactionId: null };
  });
}

/** An earlier year's one line: "Reversed · Rp …", "Charged · Rp …" or "Waived · not charged", with that year's own money. */
export function earlierFeeText(record: FeeYearRecord, currency: string): string {
  if (record.reversal) return `Reversed · ${formatMinor(record.reversal.amountMinor, currency)}`;
  if (record.charge) return `Charged · ${formatMinor(record.charge.amountMinor, currency)}`;
  return 'Waived · not charged';
}

/**
 * What is left to spend, short, for Settings' Fee waiver row: rupiah millions as the app's axis shortens them
 * (`shortMoney`, "18 jt"), after the currency; any other currency in full. Null with nothing left.
 */
export function feeToGo(remainingMinor: number, currency: string): string | null {
  if (remainingMinor <= 0) return null;
  if (currency !== 'IDR' || remainingMinor < 1_000_000) return formatMinor(remainingMinor, currency);
  return formatMinor(0, currency).replace('0', shortMoney(remainingMinor, currency));
}
