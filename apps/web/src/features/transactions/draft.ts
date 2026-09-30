import type { TransactionView } from '@expanses/db';
import { classify } from './classify';

/**
 * Opening balances and balance corrections post against system equity and have no form that can represent them; a
 * row already voided is not a row to correct. Six screens ask this, so it is asked in one place.
 *
 * All that is left of the old form's helper. `TransactionForm.tsx` was deleted and this file kept its whole
 * money pipeline alive behind its own test — `draftToLines`, `draftToExtras`, `emptyDraft`,
 * `draftFromTransaction`, a second `positive`, a `typedMcc` that was verbatim in `tx-form.ts` — roughly 130
 * lines of posting logic no screen could reach. A second copy of the posting pipeline, kept green by a test of
 * its own, is precisely the shape that brought a 100× error back past 596 passing tests, so it is gone.
 * `tx-form.ts` is the pipeline now, and it is the only one.
 */
export function isEditable(tx: TransactionView): boolean {
  return tx.status === 'posted' && !['opening', 'correction'].includes(classify(tx).type) && !isPersonWithCategory(tx);
}

/**
 * Money moved with a person that also carries a category: a loan put on a card with its fee, a repayment with its
 * interest. The transaction forms read it by its one category — as a Rp 100.000 expense, or as income — and have no
 * row for the person, so a save from them would rewrite it as a plain purchase and drop what the person owes. It
 * belongs to Lend & borrow, and the forms leave it alone.
 */
export function isPersonWithCategory(tx: TransactionView): boolean {
  const person = tx.entries.some((entry) => entry.accountSubtype === 'receivable' || entry.accountSubtype === 'payable');
  const category = tx.entries.some((entry) => entry.accountKind === 'income' || entry.accountKind === 'expense');
  return person && category;
}
