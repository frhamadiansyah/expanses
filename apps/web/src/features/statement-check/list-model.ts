import { expenseLines, incomeLines, type ListOutcome, type ListRow, transferLines } from '@expanses/core';
import { isPastDefault, type PostTransactionInput, type TransactionView } from '@expanses/db';

/**
 * The statement check for an account that is not a card, worked out without React: the counts the summary shows, the
 * "New" rows the owner reviews, and what recording them hands the ledger. The reading and the matching are core's
 * (`readTransactionList`, `matchList`); this is what the screen asks of them.
 */

export type RowType = 'expense' | 'income' | 'transfer';

/** One row of the list that is not recorded yet, as the review holds it. */
export interface NewRow {
  /** The row's place in the reading: its identity for as long as the review lasts. */
  id: number;
  note: string;
  amountMinor: number;
  /** Which way the list showed the money going; a transfer follows it. */
  direction: 'out' | 'in';
  type: RowType;
  /** '' while no category is chosen: the entry is then filed under Uncategorised. Unused by a transfer. */
  categoryId: string;
  /** The other side of a transfer; '' until said. */
  otherAccountId: string;
  occurredOn: string;
  ticked: boolean;
}

export interface ListCounts {
  recorded: number;
  new: number;
  differs: number;
  skipped: number;
  notOnList: number;
}

export function listCounts(outcomes: readonly ListOutcome[], notOnList: readonly string[]): ListCounts {
  const count = (status: ListOutcome['status']) => outcomes.filter((o) => o.status === status).length;
  return { recorded: count('recorded'), new: count('new'), differs: count('differs'), skipped: count('skipped'), notOnList: notOnList.length };
}

/**
 * The rows to record, each ticked: positive is income and negative an expense. `guesses` is the category the note's
 * history suggests, by row index.
 */
export function newRowsFrom(rows: readonly ListRow[], outcomes: readonly ListOutcome[], guesses: Readonly<Record<number, string | null | undefined>> = {}): NewRow[] {
  return rows.flatMap((row, id) =>
    outcomes[id]?.status === 'new'
      ? [
          {
            id,
            note: row.description,
            amountMinor: row.amountMinor,
            direction: row.direction,
            type: row.direction === 'in' ? ('income' as const) : ('expense' as const),
            categoryId: guesses[id] ?? '',
            otherAccountId: '',
            occurredOn: row.on,
            ticked: true,
          },
        ]
      : [],
  );
}

export function withEdit(rows: readonly NewRow[], id: number, patch: Partial<Omit<NewRow, 'id'>>): NewRow[] {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

export const toggled = (rows: readonly NewRow[], id: number): NewRow[] => rows.map((row) => (row.id === id ? { ...row, ticked: !row.ticked } : row));

export const tickedRows = (rows: readonly NewRow[]): NewRow[] => rows.filter((row) => row.ticked);

/** Something is ticked, every ticked amount is above zero, and every ticked transfer says its other account. */
export function canRecord(rows: readonly NewRow[]): boolean {
  const ticked = tickedRows(rows);
  return ticked.length > 0 && ticked.every((row) => row.amountMinor > 0 && (row.type !== 'transfer' || row.otherAccountId !== ''));
}

export const recordLabel = (rows: readonly NewRow[]) => `Record ${tickedRows(rows).length}`;

/** "Added 5 · skipped 3": the second part only when something was skipped. */
export function addedToast(added: number, skipped: number): string {
  return skipped > 0 ? `Added ${added} · skipped ${skipped}` : `Added ${added}`;
}

/**
 * What the ledger is given for the ticked rows, all in one database transaction by `postTransactions`: an expense or
 * income against the account, a transfer between the account and the other one in the direction the list showed.
 * `uncategorisedId` files an entry with no category. Throws on a ticked transfer with no other account.
 */
export function listInputs(
  rows: readonly NewRow[],
  account: { id: string; currency: string },
  uncategorisedId: { expense: string; income: string },
  ratesFor: (occurredOn: string) => Record<string, number> | undefined,
  /** The day the account's balance is counted from: an expense or income dated before it is a past purchase. */
  openedOn: string | null = null,
): PostTransactionInput[] {
  return tickedRows(rows).map((row) => {
    const { amountMinor } = row;
    const { currency } = account;
    let lines: PostTransactionInput['lines'];
    if (row.type === 'transfer') {
      if (!row.otherAccountId) throw new Error(`${row.note || 'A row'} needs the other account`);
      const [from, to] = row.direction === 'out' ? [account.id, row.otherAccountId] : [row.otherAccountId, account.id];
      lines = transferLines({ fromAccountId: from, toAccountId: to, amountMinor, currency });
    } else if (row.type === 'income') {
      lines = incomeLines({ incomeAccountId: row.categoryId || uncategorisedId.income, depositAccountId: account.id, amountMinor, currency });
    } else {
      lines = expenseLines({ categoryAccountId: row.categoryId || uncategorisedId.expense, paymentAccountId: account.id, amountMinor, currency });
    }
    const ratesToBase = ratesFor(row.occurredOn);
    const past = row.type !== 'transfer' && isPastDefault(openedOn, row.occurredOn);
    return { occurredOn: row.occurredOn, description: row.note, lines, ...(ratesToBase ? { ratesToBase } : {}), ...(past ? { pastPurchase: true } : {}) };
  });
}

/** A recorded entry as the matcher reads it: the account's own net on the transaction, and which way it went. */
export function candidateOf(view: TransactionView, accountId: string): { id: string; on: string; amountMinor: number; direction: 'out' | 'in'; description: string } | null {
  if (view.status !== 'posted') return null;
  const net = view.entries.filter((e) => e.accountId === accountId).reduce((sum, e) => sum + e.amountMinor, 0);
  if (net === 0) return null;
  return { id: view.id, on: view.occurredOn, amountMinor: Math.abs(net), direction: net < 0 ? 'out' : 'in', description: view.description };
}
