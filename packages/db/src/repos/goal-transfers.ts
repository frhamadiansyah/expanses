import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries, transactions } from '../schema';
import { assetProfiles } from '../schema-assets';
import { goalEarmarks, goals } from '../schema-goals';
import { SPENDABLE_SUBTYPES } from './accounts';
import { AssetError, assertAccountInWorkspace } from './assets';
import { GoalDbError } from './goals';
import { postTransactionTx, voidTransactionTx } from './ledger';

export interface TaggedTransferInput {
  occurredOn: string;
  description: string;
  amountMinor: number;
  fromAccountId: string;
  toAccountId: string;
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

async function canHoldSetAside(tx: Db, ws: WorkspaceContext, accountId: string): Promise<boolean> {
  const [account] = await tx
    .select({ subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) return false;
  // Money can wait for a goal wherever it can be set aside, or in a holding the owner groups as investments.
  if (SPENDABLE_SUBTYPES.includes(account.subtype)) return true;
  const [profile] = await tx
    .select({ planGroup: assetProfiles.planGroup })
    .from(assetProfiles)
    .where(and(eq(assetProfiles.accountId, accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
  return profile?.planGroup === 'invest';
}

/**
 * Moves a goal's set-aside on one account by `deltaMinor`, never below zero, and returns what is left.
 * Used when money is parked for a goal and when a purchase spends it.
 */
export async function adjustSetAsideTx(tx: Db, ws: WorkspaceContext, goalId: string, accountId: string, deltaMinor: number): Promise<number> {
  const [existing] = await tx
    .select({ amountMinor: goalEarmarks.amountMinor })
    .from(goalEarmarks)
    .where(and(eq(goalEarmarks.goalId, goalId), eq(goalEarmarks.accountId, accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
  const next = Math.max(0, (existing?.amountMinor ?? 0) + deltaMinor);

  if (next === 0) {
    if (existing) {
      await tx
        .delete(goalEarmarks)
        .where(and(eq(goalEarmarks.goalId, goalId), eq(goalEarmarks.accountId, accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
    }
    return 0;
  }
  if (existing) {
    await tx
      .update(goalEarmarks)
      .set({ amountMinor: next })
      .where(and(eq(goalEarmarks.goalId, goalId), eq(goalEarmarks.accountId, accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
    return next;
  }
  await tx.insert(goalEarmarks).values({ goalId, accountId, workspaceId: ws.workspaceId, amountMinor: next });
  return next;
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

    const transactionId = await postTransactionTx(tx, ws, {
      occurredOn: input.occurredOn,
      description: input.description,
      lines: [
        { accountId: input.toAccountId, amountMinor: input.amountMinor, currency: to?.currency ?? ws.baseCurrency },
        { accountId: input.fromAccountId, amountMinor: -input.amountMinor, currency: from?.currency ?? ws.baseCurrency },
      ],
      ratesToBase: input.ratesToBase,
      excludedFromReport: input.excludedFromReport,
      eventId: input.eventId,
      photoIds: input.photoIds,
    });

    if (!input.goalId) return { transactionId, setAsideMinor: 0 };
    await tx.update(transactions).set({ goalId: input.goalId }).where(eq(transactions.id, transactionId));
    if (!(await canHoldSetAside(tx, ws, input.toAccountId))) return { transactionId, setAsideMinor: 0 };
    const setAsideMinor = await adjustSetAsideTx(tx, ws, input.goalId, input.toAccountId, input.amountMinor);
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
