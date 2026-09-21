import { exchangeLines, uuidv7 } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, transactions } from '../schema';
import { goalDraws, goalEarmarks, goals } from '../schema-goals';
import { systemAccountId } from './accounts';
import { AssetError, assertAccountInWorkspace } from './assets';
import { recordContributionTx } from './goal-contributions';
import { GoalDbError } from './goals';
import { postTransactionTx, voidTransactionTx } from './ledger';
import { adjustSetAsideTx, canHoldSetAside, type SetAsideChoice, setAsideTablesExist } from './set-aside-tx';

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
  /** Which goal the money came out of, when it took more than was free (spec §4.4). */
  setAside?: SetAsideChoice | null;
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
      setAside: input.setAside,
    });

    if (!input.goalId) return { transactionId, setAsideMinor: 0 };
    await tx.update(transactions).set({ goalId: input.goalId }).where(eq(transactions.id, transactionId));
    if (!(await canHoldSetAside(tx, ws, input.toAccountId))) return { transactionId, setAsideMinor: 0 };
    // The goal's own promise on the source follows its money, so the goal does not count it in both places (spec §4.6).
    const [own] = await tx
      .select({ amountMinor: goalEarmarks.amountMinor })
      .from(goalEarmarks)
      .where(and(eq(goalEarmarks.goalId, input.goalId), eq(goalEarmarks.accountId, input.fromAccountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
    const moved = Math.min(input.amountMinor, own?.amountMinor ?? 0);
    // Only where the draw that undoes it can be written: a database stopped at 49 parks exactly as it did before, the
    // source promise untouched, so a void cannot leave the goal with no promise anywhere.
    if (moved > 0 && (await setAsideTablesExist(tx))) {
      await adjustSetAsideTx(tx, ws, input.goalId, input.fromAccountId, -moved);
      await recordContributionTx(tx, ws, input.goalId, input.fromAccountId, -moved, input.occurredOn);
      // A move with no destination: the destination's own adjustment is taken back by voidTransactionTx.
      await tx.insert(goalDraws).values({
        id: uuidv7(),
        workspaceId: ws.workspaceId,
        transactionId,
        goalId: input.goalId,
        accountId: input.fromAccountId,
        intent: 'move',
        amountMinor: moved,
        toAccountId: null,
        toAmountMinor: null,
        stageId: null,
        wasWhole: 0,
        wholeSince: null,
        occurredOn: input.occurredOn,
        createdAt: new Date().toISOString(),
      });
    }
    // The set-aside sits on the destination account, so it is counted in the destination account's own money —
    // parking US$100 against a goal sets US$100 aside, never Rp 1.600.000 of a USD balance.
    const setAsideMinor = await adjustSetAsideTx(tx, ws, input.goalId, input.toAccountId, landedMinor);
    return { transactionId, setAsideMinor };
  });
}

/**
 * Voids a tagged transfer and takes the money back out of the goal's set-aside. The taking back is
 * `voidTransactionTx`'s own, so the plain delete and an edit do exactly the same.
 */
export async function voidTaggedTransfer(database: Database, ws: WorkspaceContext, transactionId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.workspaceId, ws.workspaceId)));
    if (!row) throw new AssetError('That transfer is not in this workspace');
    await voidTransactionTx(tx, ws, transactionId);
  });
}
