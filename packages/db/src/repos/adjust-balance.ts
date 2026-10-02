import { and, eq, isNull } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { bookCategories } from '../schema-books';
import { withCapture } from '../sync/capture';
import { createAccountTx, ensureSystemAccountTx, MONEY_SUBTYPES } from './accounts';
import { hasBooks, personalBookIdTx } from './books';
import { nativeBalancesTx, postTransactionTx } from './ledger';

export class AdjustBalanceError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'NOT_MONEY' | 'NO_DIFFERENCE' | 'BAD_INPUT',
    message: string,
  ) {
    super(message);
    this.name = 'AdjustBalanceError';
  }
}

/**
 * What the difference was: money spent or received that nobody wrote down, which counts in Cashflow under
 * Unrecorded spending or Unrecorded income; or a figure that was simply wrong, which only moves the balance.
 */
export type AdjustAs = 'cashflow' | 'correction';

export interface AdjustBalanceInput {
  accountId: string;
  /** What the account actually holds on `onDate`, in its own currency's minor units. */
  actualMinor: number;
  /** YYYY-MM-DD. The difference is taken from the balance on this day, and posted on it. */
  onDate: string;
  as: AdjustAs;
  /** Units of base per one major unit of the account's currency, when that is not the base. */
  rateToBase?: number;
}

/** Where a Cashflow adjustment is filed: a category of its own each way, made the first time it is needed. */
export const UNRECORDED = {
  spending: { key: 'unrecorded_spending', name: 'Unrecorded spending', kind: 'expense' },
  income: { key: 'unrecorded_income', name: 'Unrecorded income', kind: 'income' },
} as const;

/**
 * Sets an account's balance on a day to what was counted, as one transaction for the difference.
 *
 * The difference is against the balance on that day, not today's: a count dated last week fixes last week, and what
 * moved since still moves the balance on from there. Nothing is posted when the count agrees — there is nothing to
 * say. A pocket is an account of its own, so the adjustment is always in the one currency it holds.
 */
export async function adjustBalance(
  database: Database,
  ws: WorkspaceContext,
  input: AdjustBalanceInput,
): Promise<{ transactionId: string; differenceMinor: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.onDate)) throw new AdjustBalanceError('BAD_INPUT', 'Choose the day it was counted');
  if (!Number.isSafeInteger(input.actualMinor)) throw new AdjustBalanceError('BAD_INPUT', 'Enter what the account actually holds');
  return database.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!account) throw new AdjustBalanceError('NOT_FOUND', 'That account is not in this workspace');
    if (account.kind !== 'asset' || !MONEY_SUBTYPES.includes(account.subtype) || !account.currency) {
      throw new AdjustBalanceError('NOT_MONEY', `${account.name} is not money whose balance can be counted`);
    }
    const currency = account.currency;
    const balance = (await nativeBalancesTx(tx, ws, input.onDate))[account.id] ?? 0;
    const difference = input.actualMinor - balance;
    if (difference === 0) throw new AdjustBalanceError('NO_DIFFERENCE', 'That is already the balance: there is nothing to adjust');

    const otherSide =
      input.as === 'correction'
        ? await ensureSystemAccountTx(tx, ws, 'balance_correction')
        : await unrecordedCategoryTx(tx, ws, difference < 0 ? UNRECORDED.spending : UNRECORDED.income);
    const transactionId = await postTransactionTx(tx, ws, {
      occurredOn: input.onDate,
      description: account.subtype === 'cash' ? 'Counted cash' : 'Balance adjusted',
      lines: [
        { accountId: account.id, amountMinor: difference, currency },
        { accountId: otherSide, amountMinor: -difference, currency },
      ],
      ratesToBase: input.rateToBase ? { [currency]: input.rateToBase } : {},
    });
    return { transactionId, differenceMinor: difference };
  });
}

/**
 * The open book's Unrecorded spending or Unrecorded income, found by its key or made at the top of the tree.
 *
 * Looked up in the one book only, never the workspace at large: another book's copy would file this book's
 * adjustment into it. Not a default category — it is made where it is first used, so a workspace that never counts
 * its cash never sees it in a picker. An archived one is still the one: it keeps what was filed there together.
 */
async function unrecordedCategoryTx(tx: Db, ws: WorkspaceContext, spec: (typeof UNRECORDED)[keyof typeof UNRECORDED]): Promise<string> {
  const bookId = (await hasBooks(tx)) ? (ws.bookId ?? (await personalBookIdTx(tx, ws.workspaceId))) : null;
  const found = bookId
    ? await tx
        .select({ id: accounts.id, archivedAt: accounts.archivedAt })
        .from(accounts)
        .innerJoin(bookCategories, eq(bookCategories.categoryAccountId, accounts.id))
        .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.systemKey, spec.key), eq(accounts.kind, spec.kind), eq(bookCategories.bookId, bookId)))
    : await tx
        .select({ id: accounts.id, archivedAt: accounts.archivedAt })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.systemKey, spec.key), eq(accounts.kind, spec.kind), isNull(accounts.parentId)));
  const live = found.find((row) => row.archivedAt === null) ?? found[0];
  if (live) return live.id;
  const made = await createAccountTx(tx, ws, { kind: spec.kind, subtype: 'category', name: spec.name, currency: null });
  await withCapture(tx, { entity: 'category', id: made.id }, () => tx.update(accounts).set({ systemKey: spec.key }).where(eq(accounts.id, made.id)));
  return made.id;
}
