/** The workspace a row is filed in, as an account's history reports it. */
export interface RowBook {
  id: string;
  name: string;
  kind: string;
}

/**
 * Which workspace has to be open before a row can be edited — null when the open one already is it.
 *
 * An account is yours, so its history holds every workspace; but a transaction is filed by the workspace of the
 * category it is posted to, and every category picker on that page offers the open workspace's categories only.
 * Saving such a row where it is shown would re-file it, moving another workspace's spending without a word — so
 * the row stays read-only until its own workspace is open.
 */
export function editInsteadIn(book: RowBook | null | undefined, openBookId: string | null | undefined): RowBook | null {
  if (!book || !openBookId) return null;
  return book.id === openBookId ? null : book;
}

/** Said in the product's word, naming the workspace to open, since the row itself cannot be made to fit. */
export function openToEditMessage(book: RowBook): string {
  return `Filed in ${book.name} — open that workspace to edit it.`;
}
