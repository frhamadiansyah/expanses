import { listExpenseTemplates, type TransactionView } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { editInsteadIn, type RowBook } from '../workspaces/filing';
import { useWorkspaceBadges } from '../workspaces/queries';
import { useTrades } from '../networth/queries';
import { isEditable } from './draft';

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
  return { changeable: isEditable(tx) && !elsewhere && trades.isSuccess && !isTrade, elsewhere, isTrade };
}
