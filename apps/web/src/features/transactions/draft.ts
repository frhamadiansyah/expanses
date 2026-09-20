import type { TransactionView } from '@expanses/db';
import { classify } from './classify';

/**
 * Opening balances post against system equity and have no form that can represent them; a row already voided is
 * not a row to correct. Six screens ask this, so it is asked in one place.
 *
 * All that is left of the old form's helper. `TransactionForm.tsx` was deleted and this file kept its whole
 * money pipeline alive behind its own test — `draftToLines`, `draftToExtras`, `emptyDraft`,
 * `draftFromTransaction`, a second `positive`, a `typedMcc` that was verbatim in `tx-form.ts` — roughly 130
 * lines of posting logic no screen could reach. A second copy of the posting pipeline, kept green by a test of
 * its own, is precisely the shape that brought a 100× error back past 596 passing tests, so it is gone.
 * `tx-form.ts` is the pipeline now, and it is the only one.
 */
export function isEditable(tx: TransactionView): boolean {
  return tx.status === 'posted' && classify(tx).type !== 'opening';
}
