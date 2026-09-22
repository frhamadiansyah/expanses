import type { MaturityChoice } from '@expanses/core';
import { type AccountRow, payoutAccepts, pocketParentIds } from '@expanses/db';
import { rateBpsFrom, termLabel } from './deposit-terms';

export { termLabel };

export const MATURITY_CHOICES: readonly { id: MaturityChoice; title: string; /** What the deposit's own row reads once this is the answer. */ row: string; subtitle: (payout: string | null) => string }[] = [
  { id: 'principal', title: 'Roll over the principal', row: 'Roll over, interest out', subtitle: (payout) => `Interest lands in ${payout ?? 'the account below'}` },
  { id: 'principal_interest', title: 'Roll over principal + interest', row: 'Roll over in full', subtitle: () => 'Nothing lands; the deposit grows' },
  { id: 'close', title: "Don't roll over", row: "Don't roll over", subtitle: (payout) => `Everything lands in ${payout ?? 'the account below'}` },
];

/**
 * Where the money may land: `payoutAccepts`, the rule `saveDepositAutomation` refuses by, so the list never offers a
 * refusal. `accounts` is every account of the workspace, archived ones included, so an account whose pockets are all
 * archived is still known to be a parent, as the repo and the ledger know it.
 */
export function payoutChoices(accounts: readonly AccountRow[], currency: string, depositId: string): AccountRow[] {
  const parents = pocketParentIds(accounts);
  return accounts.filter((account) => payoutAccepts(account, currency, depositId, parents));
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

/**
 * One save after another: each task starts only once the one before it has settled, failed or not. The settings
 * group saves a whole snapshot on every change, so this is what keeps an older snapshot from landing last and
 * silently undoing a newer change (spec §3: saves are never lost).
 */
export function saveQueue(): (task: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}
