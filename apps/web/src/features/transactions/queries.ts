import { allPhotoRows, listExpenseTemplates, type TransactionView } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { editInsteadIn, type RowBook } from '../workspaces/filing';
import { useWorkspaceBadges } from '../workspaces/queries';
import { useTrades } from '../networth/queries';
import { isEditable } from './draft';

/**
 * The pictures one transaction already has, for the draft a correction opens with.
 *
 * **One reader, for both ways into a correction.** The card had this inline and the phone's edit sheet had
 * nothing at all — it left `formFromTransaction`'s fourth argument off, so Photos read "None" on a transaction
 * that plainly had a receipt.
 *
 * `allPhotoRows` under the key `PhotosSheet` already uses, so the sheet that opens next finds it in the cache
 * rather than asking again. `refetchOnMount: 'always'` with `isFetchedAfterMount` is the pair that makes
 * `ready` mean something: this app's QueryClient holds every query fresh for ever (`staleTime: Infinity`), so
 * a screen that filled this entry earlier would otherwise leave the next one waiting on a fetch that never
 * comes — and rows cached *before* a save re-keyed the pictures onto their transaction hold none of them.
 *
 * Adding a transaction asks for nothing: there are no pictures to find, and the figure is the first thing a
 * thumb reaches for, so the card must not wait on a query to be drawn at all.
 */
export function useTransactionPhotoIds(transactionId: string | null): { ready: boolean; ids: string[] } {
  const { database, ws } = useApp();
  const photos = useQuery({
    queryKey: ['all-photo-rows', ws.workspaceId],
    queryFn: () => allPhotoRows(database, ws),
    enabled: !!transactionId,
    refetchOnMount: 'always',
  });
  if (!transactionId) return { ready: true, ids: [] };
  return {
    ready: photos.isFetchedAfterMount,
    ids: (photos.data ?? []).filter((row) => row.transactionId === transactionId).map((row) => row.id),
  };
}

export function useExpenseTemplates() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['expense-templates', ws.workspaceId, ws.bookId ?? null], queryFn: () => listExpenseTemplates(database, ws) });
}

/** Why a transaction may not be changed here — or `changeable`, when none of the three reasons applies. */
export interface Changeable {
  changeable: boolean;
  /** The workspace that has to be open first; null when this one already is it. */
  elsewhere: RowBook | null;
  /** A trade's money half. Its units live in `trades`, so it is corrected on Buy & sell or not at all. */
  isTrade: boolean;
}

/**
 * Whether this transaction may be changed here, given everything a screen can know about it.
 *
 * Pure, and apart from the hook, so the rule can be held to by a test rather than only by a running browser.
 *
 * Both unanswered questions have to be **waited for**, and for the same reason: an unanswered query looks
 * exactly like a "no". `tradesKnown` was waited for and `filingKnown` was not — so for as long as
 * `['book-names', …]` was in flight every row looked unfiled, `elsewhere` was null, and Edit *and Delete* were
 * drawn on a row belonging to another workspace. `replaceTransaction` refuses a write across books;
 * `voidTransactionTx` scopes by workspace and **not** by book, so a Delete landing inside that window has no
 * backstop anywhere below this line. `TransactionsPage` and `EventDetailPage` already wait on exactly this.
 */
export function changeableWhen({
  editable,
  elsewhere,
  isTrade,
  tradesKnown,
  filingKnown,
}: {
  editable: boolean;
  /** The workspace this row is filed in, when it is not the open one. Meaningless until `filingKnown`. */
  elsewhere: RowBook | null;
  isTrade: boolean;
  tradesKnown: boolean;
  filingKnown: boolean;
}): boolean {
  return editable && tradesKnown && filingKnown && !isTrade && !elsewhere;
}

/**
 * The three refusals every way into a transaction carries, asked in one place.
 *
 * A trade's units live in `trades` and the transaction is only its money half: editing posts a **new** id and
 * leaves the trade row pointing at a transaction that no longer exists, and voiding hands the cash back while
 * the units stay held — net worth rising by the price of something nobody bought. `isEditable` carries the
 * other two: an opening balance posts against system equity and has no form that could represent it, and a row
 * already deleted is not a row to correct. Filing is the third: an account's history holds every workspace, and
 * saving another workspace's row here would re-file its spending without a word.
 *
 * Nothing is offered until the trades are in. An unanswered query looks exactly like "not a trade", and a screen
 * that offered Edit for the half-second before the answer arrived would be the same defect with a smaller window.
 *
 * `TransactionsPage`, the receipt and the form route all ask this rather than each keeping a copy — a refusal
 * that exists in three copies is a refusal two of them will one day be missing.
 */
export function useChangeable(tx: TransactionView | null): Changeable {
  const { ws } = useApp();
  const trades = useTrades();
  const badges = useWorkspaceBadges(tx ? [tx.id] : []);
  if (!tx) return { changeable: false, elsewhere: null, isTrade: false };
  const elsewhere = editInsteadIn(badges.of(tx.id), ws.bookId);
  const isTrade = (trades.data ?? []).some((trade) => trade.transactionId === tx.id);
  return {
    changeable: changeableWhen({
      editable: isEditable(tx),
      elsewhere,
      isTrade,
      tradesKnown: trades.isSuccess,
      // `useWorkspaceBadges` exposes `ready` for exactly this, and says so.
      filingKnown: badges.ready,
    }),
    elsewhere,
    isTrade,
  };
}
