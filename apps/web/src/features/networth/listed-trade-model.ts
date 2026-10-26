import { formatMinor, ppmPercent } from '@expanses/core';

/** The broker's worked-out fee and tax for a trade. */
export interface WorkedOut {
  feeMinor: number;
  taxMinor: number;
}

/**
 * What the sheet puts on the trade before anything is typed. A trade made before the app (Past purchase / Past sale)
 * starts with no fee and no tax: the broker's rates are for a trade made today, and a fee typed in the details still
 * replaces this figure.
 */
export function workedOut(past: boolean, charge: WorkedOut | null): WorkedOut | null {
  return past ? { feeMinor: 0, taxMinor: 0 } : charge;
}

/**
 * What the folded fee row reads: the rate first, then the amount ("0,15% · Rp 2.500"); the amount alone once a fee or
 * tax is typed (no rate describes it); "None" for a past trade with nothing typed.
 */
export function feeRowText(o: { past: boolean; typed: boolean; chargedMinor: number; ratePpm: number | null; currency: string }): string {
  const amount = formatMinor(o.chargedMinor, o.currency);
  if (o.typed) return amount;
  if (o.past) return 'None';
  return o.ratePpm === null ? amount : `${ppmPercent(o.ratePpm)} · ${amount}`;
}

/** "1 lot · 100 shares", "2 lots · 200 shares". */
export function lotsText(lots: number, lotSize: number): string {
  const shares = lots * lotSize;
  return `${lots} ${lots === 1 ? 'lot' : 'lots'} · ${shares.toLocaleString('id-ID')} ${shares === 1 ? 'share' : 'shares'}`;
}
