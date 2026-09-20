import { describe, expect, it } from 'vitest';
import type { RowBook } from '../workspaces/filing';
import { changeableWhen } from './queries';

const theirs: RowBook = { id: 'book-theirs', name: 'Household', kind: 'book' };

/** Everything known, nothing wrong: the row is this workspace's, posted, and not a trade. */
const settled = { editable: true, elsewhere: null, isTrade: false, tradesKnown: true, filingKnown: true };

describe('whether a transaction may be changed here', () => {
  it('is yes only once every question has an answer and none of them refuses', () => {
    expect(changeableWhen(settled)).toBe(true);
    expect(changeableWhen({ ...settled, editable: false })).toBe(false);
    expect(changeableWhen({ ...settled, isTrade: true })).toBe(false);
    expect(changeableWhen({ ...settled, elsewhere: theirs })).toBe(false);
  });

  /*
   * The defect. `useChangeable` waited for `trades.isSuccess` — and argued at length in its own docstring why
   * an unanswered query must not look like "not a trade" — and then did not apply that argument to the badges.
   *
   * While `['book-names', …]` is in flight every row looks unfiled, so `elsewhere` is null and looks like "this
   * workspace's". Edit **and Delete** were drawn on another workspace's row for that window.
   * `replaceTransaction` has an OTHER_BOOK guard; `voidTransactionTx` scopes by workspace and not by book, so a
   * Delete that lands inside the window has no backstop anywhere. Both unanswered questions are waited for.
   */
  it('waits for the filing exactly as it waits for the trades, because neither silence is a no', () => {
    expect(changeableWhen({ ...settled, filingKnown: false })).toBe(false);
    expect(changeableWhen({ ...settled, tradesKnown: false })).toBe(false);
    // And the pair of them says the same thing whichever is outstanding — one is not weaker than the other.
    expect(changeableWhen({ ...settled, filingKnown: false })).toBe(changeableWhen({ ...settled, tradesKnown: false }));
    // A row that really is this workspace's becomes changeable the moment the answer arrives, and not before.
    expect(changeableWhen({ ...settled, filingKnown: true })).toBe(true);
  });

  it('stays no when the answer, once it arrives, says another workspace', () => {
    // The window closing must not be mistaken for permission: waiting and refusing are different answers.
    expect(changeableWhen({ ...settled, elsewhere: theirs, filingKnown: true })).toBe(false);
  });
});
