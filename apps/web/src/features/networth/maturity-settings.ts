import type { MaturityChoice } from '@expanses/core';
import { type AccountRow, payoutAccepts } from '@expanses/db';
import { rateBpsFrom } from './deposit-terms';

export const MATURITY_CHOICES: readonly { id: MaturityChoice; title: string; subtitle: (payout: string | null) => string }[] = [
  { id: 'principal', title: 'Roll over the principal', subtitle: (payout) => `Interest lands in ${payout ?? 'the account below'}` },
  { id: 'principal_interest', title: 'Roll over principal + interest', subtitle: () => 'Nothing lands; the deposit grows' },
  { id: 'close', title: "Don't roll over", subtitle: (payout) => `Everything lands in ${payout ?? 'the account below'}` },
];

export const termLabel = (months: number): string => `${months} ${months === 1 ? 'month' : 'months'}`;

/** Where the money may land: `payoutAccepts`, the rule `saveDepositAutomation` refuses by, so the list never offers a refusal. */
export function payoutChoices(accounts: readonly AccountRow[], currency: string, depositId: string): AccountRow[] {
  return accounts.filter((account) => payoutAccepts(account, currency, depositId));
}

/**
 * The typed withholding in basis points, 0–100 %. `parseRate` refuses zero (a rate must be positive), but no tax at
 * all is a real answer. A figure made only of zeros is therefore 0, whichever separator it uses. Anything else goes to
 * the one reader.
 */
export function taxBpsFrom(text: string): number {
  if (/^\s*0+([.,]0*)?\s*$/.test(text)) return 0;
  const bps = rateBpsFrom(text);
  if (bps < 0 || bps > 10_000) throw new Error('Tax withheld is a percentage from 0 to 100');
  return bps;
}
