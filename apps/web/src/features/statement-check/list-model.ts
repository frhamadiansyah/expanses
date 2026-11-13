import { evaluateExact, expenseLines, exponentOf, incomeLines, type ListOutcome, type ListRow, transferLines } from '@expanses/core';
import { isPastDefault, type PostTransactionInput, type TransactionView } from '@expanses/db';
import { decimalsDirection, type FormDraft } from '../transactions/tx-form';

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

/**
 * A new row, opened on the full Add screen (as Review opens a capture): the form's fields over an empty form. The
 * account is Paid with (or Received into); a transfer stands on the side the list showed, the other account opposite.
 */
export function formOfRow(row: NewRow, accountId: string, currency: string): Partial<FormDraft> {
  const transfer = row.type === 'transfer';
  const exponent = exponentOf(currency);
  return {
    mode: row.type,
    occurredOn: row.occurredOn,
    description: row.note,
    moneyId: transfer && row.direction === 'in' ? row.otherAccountId : accountId,
    toId: transfer ? (row.direction === 'out' ? row.otherAccountId : accountId) : '',
    categoryId: transfer ? '' : row.categoryId,
    amount: String(Number((row.amountMinor / 10 ** exponent).toFixed(exponent))),
    // A transfer offers no flag: its figure is the From account's own currency.
    currency: transfer ? '' : currency,
  };
}

/**
 * The full Add screen's form, written back onto its row: nothing is posted (the check's own Record does that). The row
 * stays this account's: an expense or income paid with it, a transfer with it on one side. Throws, with what to put
 * right, on a form that is not such a row or has no figure above zero.
 */
export function editFromForm(
  form: FormDraft,
  accountId: string,
  currency: string,
  /** The accounts a transfer may name on its other side (open, in the account's currency); left out, any. */
  others?: readonly string[],
): Partial<Omit<NewRow, 'id' | 'ticked'>> {
  if (form.mode !== 'expense' && form.mode !== 'income' && form.mode !== 'transfer') throw new Error('A row is recorded as an expense, income or a transfer');
  if (form.mode !== 'transfer' && form.currency && form.currency !== currency) throw new Error(`A row of this list is in ${currency}`);
  if (form.partner) throw new Error('A transfer with a partner is recorded on its own, not as a row of this list');
  const read = evaluateExact(form.amount, currency, { fractional: decimalsDirection(form) ?? undefined });
  if (read === null || read.minor <= 0) throw new Error('Amount must be greater than zero');
  const common = { type: form.mode, amountMinor: read.minor, note: form.description.trim(), occurredOn: form.occurredOn };
  if (form.mode === 'transfer') {
    const side = form.moneyId === accountId ? ('out' as const) : form.toId === accountId ? ('in' as const) : null;
    if (side === null) throw new Error('A transfer on this list has this account on one side');
    const otherAccountId = side === 'out' ? form.toId : form.moneyId;
    if (others && otherAccountId && !others.includes(otherAccountId)) throw new Error(`The other account of a transfer here is an open ${currency} account`);
    return { ...common, direction: side, otherAccountId, categoryId: '' };
  }
  if (form.moneyId !== accountId) throw new Error(form.mode === 'income' ? 'Received into stays this account' : 'Paid with stays this account');
  return { ...common, direction: form.mode === 'income' ? 'in' : 'out', categoryId: form.categoryId, otherAccountId: '' };
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
