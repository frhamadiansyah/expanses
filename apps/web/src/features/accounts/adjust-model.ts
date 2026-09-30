import { formatMinor, parseMajor } from '@expanses/core';
import type { AccountSubtype, AdjustAs } from '@expanses/db';

/** The sheet's name: cash is counted; anything else has its balance adjusted to what the bank or the app says. */
export const adjustTitle = (subtype: AccountSubtype): string => (subtype === 'cash' ? 'Count cash' : 'Adjust balance');

/**
 * What the difference most likely was. Cash that comes up short was nearly always spent without being written down,
 * so it counts in Cashflow; a bank or a wallet that disagrees was more often simply recorded wrong.
 */
export const defaultAdjustAs = (subtype: AccountSubtype): AdjustAs => (subtype === 'cash' ? 'cashflow' : 'correction');

/** What was typed less what the app holds, or null while nothing readable is typed. */
export function adjustDifference(typed: string, currency: string, balanceMinor: number): number | null {
  if (typed.trim() === '') return null;
  try {
    return parseMajor(typed, currency) - balanceMinor;
  } catch {
    return null;
  }
}

/** "Rp 45.000 less": the part of "… than the app says" set in the colour of the way it moved. */
export function differenceWords(differenceMinor: number, currency: string): string {
  return `${formatMinor(Math.abs(differenceMinor), currency)} ${differenceMinor < 0 ? 'less' : 'more'}`;
}

/** The two answers to "what was it", worded for the way the figure moved. */
export function adjustChoices(differenceMinor: number): { value: AdjustAs; label: string; detail: string }[] {
  const less = differenceMinor < 0;
  return [
    {
      value: 'cashflow',
      label: less ? 'Spending I didn’t record' : 'Income I didn’t record',
      detail: less ? 'Counts in Cashflow, as “Unrecorded spending”' : 'Counts in Cashflow, as “Unrecorded income”',
    },
    { value: 'correction', label: 'Just a correction', detail: `Fixes the balance; not counted as ${less ? 'spending' : 'income'}` },
  ];
}
