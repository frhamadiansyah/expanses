import { exchangeLines } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries, transactions } from '../schema';
import { goalEarmarks, goals } from '../schema-goals';
import { systemAccountId } from './accounts';
import { AssetError, assertAccountInWorkspace } from './assets';
import { GoalDbError } from './goals';
import { postTransactionTx, voidTransactionTx } from './ledger';
import { adjustSetAsideTx, canHoldSetAside } from './set-aside-tx';

export interface TaggedTransferInput {
  occurredOn: string;
  description: string;
  amountMinor: number;
  fromAccountId: string;
  toAccountId: string;
  /**
   * What actually landed, in the destination account's own currency — required when the two accounts differ in
   * currency and refused when they do not.
   *
   * A posting balances per currency, so a cross-currency move cannot post one figure on both legs: doing that is
   * what answered "Lines in USD sum to 1600000, expected 0". It is the same Received amount the plain transfer
   * already asks for, and it is also what the goal has parked — the destination account holds destination money.
   */
  toAmountMinor?: number | null;
  /** Null moves the money without attaching it to anything. */
  goalId: string | null;
  ratesToBase?: Record<string, number>;
  /** Leaves the chart, the budgets and the category totals; balances, statements and net worth keep it. */
  excludedFromReport?: boolean;
  /** The event this belongs to. */
  eventId?: string | null;
  /** Photo rows written before the transaction had an id. Tagging a goal cannot be what loses a receipt. */
  photoIds?: string[];
}

export interface TaggedTransferResult {
  transactionId: string;
  /** What the goal now has set aside in the destination account. */
  setAsideMinor: number;
}

async function assertGoal(tx: Db, ws: WorkspaceContext, goalId: string): Promise<void> {
  const [goal] = await tx.select({ id: goals.id }).from(goals).where(and(eq(goals.id, goalId), eq(goals.workspaceId, ws.workspaceId)));
  if (!goal) throw new GoalDbError('Goal not found in this workspace');
}

/**
 * Moves money between your own accounts and, when a goal is named, parks it against that goal
 * from the day it leaves the spending account — months before it becomes units.
 */
export async function recordTaggedTransfer(database: Database, ws: WorkspaceContext, input: TaggedTransferInput): Promise<TaggedTransferResult> {
  if (!(input.amountMinor > 0)) throw new AssetError('Enter an amount greater than zero');
  if (input.fromAccountId === input.toAccountId) throw new AssetError('Choose two different accounts');

  return database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, input.fromAccountId, 'Account');
    await assertAccountInWorkspace(tx, ws, input.toAccountId, 'Account');
    if (input.goalId) await assertGoal(tx, ws, input.goalId);

    const [from] = await tx
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, input.fromAccountId), eq(accounts.workspaceId, ws.workspaceId)));
    const [to] = await tx
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, input.toAccountId), eq(accounts.workspaceId, ws.workspaceId)));

    const fromCurrency = from?.currency ?? ws.baseCurrency;
    const toCurrency = to?.currency ?? ws.baseCurrency;
    /*
     * What landed. Same currency on both sides and it is what left; different currencies and it has to be told,
     * because nothing here can invent a rate the bank used. `exchangeLines` is the core kit's one producer of a
     * cross-currency movement — the plain transfer goes through it too, so a tagged transfer and an untagged one
     * cannot post two different shapes of the same money.
     */
    const crossCurrency = fromCurrency !== toCurrency;
    if (crossCurrency && !(input.toAmountMinor! > 0)) {
      throw new AssetError(`Enter what landed in the destination account, in ${toCurrency}`);
    }
    const landedMinor = crossCurrency ? input.toAmountMinor! : input.amountMinor;
    const lines = crossCurrency
      ? exchangeLines({
          fromAccountId: input.fromAccountId,
          fromAmountMinor: input.amountMinor,
          fromCurrency,
          toAccountId: input.toAccountId,
          toAmountMinor: landedMinor,
          toCurrency,
          exchangeAccountId: await systemAccountId(tx, ws, 'currency_exchange'),
        })
      : [
          { accountId: input.toAccountId, amountMinor: landedMinor, currency: toCurrency },
          { accountId: input.fromAccountId, amountMinor: -input.amountMinor, currency: fromCurrency },
        ];

    const transactionId = await postTransactionTx(tx, ws, {
      occurredOn: input.occurredOn,
      description: input.description,
      lines,
      ratesToBase: input.ratesToBase,
      excludedFromReport: input.excludedFromReport,
      eventId: input.eventId,
      photoIds: input.photoIds,
    });

    if (!input.goalId) return { transactionId, setAsideMinor: 0 };
    await tx.update(transactions).set({ goalId: input.goalId }).where(eq(transactions.id, transactionId));
    if (!(await canHoldSetAside(tx, ws, input.toAccountId))) return { transactionId, setAsideMinor: 0 };
    // The set-aside sits on the destination account, so it is counted in the destination account's own money —
    // parking US$100 against a goal sets US$100 aside, never Rp 1.600.000 of a USD balance.
    const setAsideMinor = await adjustSetAsideTx(tx, ws, input.goalId, input.toAccountId, landedMinor);
    return { transactionId, setAsideMinor };
  });
}

/** Voids a tagged transfer and takes the money back out of the goal's set-aside. */
export async function voidTaggedTransfer(database: Database, ws: WorkspaceContext, transactionId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .select({ goalId: transactions.goalId })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.workspaceId, ws.workspaceId)));
    if (!row) throw new AssetError('That transfer is not in this workspace');

    if (row.goalId) {
      // Whatever this transfer put into an account comes back out of the goal's set-aside.
      const lines = await tx
        .select({ accountId: entries.accountId, amountMinor: entries.amountMinor })
        .from(entries)
        .where(and(eq(entries.transactionId, transactionId), eq(entries.workspaceId, ws.workspaceId)));
      for (const line of lines) {
        if (line.amountMinor > 0) await adjustSetAsideTx(tx, ws, row.goalId, line.accountId, -line.amountMinor);
      }
    }
    await voidTransactionTx(tx, ws, transactionId);
  });
}
