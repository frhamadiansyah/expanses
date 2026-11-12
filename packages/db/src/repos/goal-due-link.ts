import type { MoneyLine } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { nativeBalances, nativeBalancesTx } from './ledger';
import { setAsideView } from './set-aside';
import { type TaggedMove, taggedMoveOfTx } from './set-aside-tx';

/*
 * A goal's due month that was a Transfer (goal_due_months, 0111) is new money for the goal: only what goes past From's
 * free money moves the goal's own promise there. These keep that rule when the transfer is posted and whenever it is
 * edited later, and keep the month pointing at the transfer standing now. Plain SQL on this phone's own table, guarded
 * so a database before 0111 reads as no due month at all.
 */

/** The new-money rule for one transfer out of `fromAccountId`, worked out before its database transaction. */
export interface DueCap {
  fromAccountId: string;
  /** The day the balance and the free money were read for. */
  date: string;
  /** From's balance when the free money was read: checked again inside the transaction. */
  balanceMinor: number;
  /** The most of the goal's promise on From that may follow the money: what went past the free money. */
  promiseFollowsAtMost: number;
}

export class BalancesChangedError extends Error {
  constructor() {
    super('Balances just changed. Try again.');
    this.name = 'BalancesChangedError';
  }
}

const present = new WeakMap<Db, boolean>();

async function dueMonthsExist(db: Db): Promise<boolean> {
  if (present.get(db)) return true;
  const rows = await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'goal_due_months'`);
  if (rows.length > 0) present.set(db, true);
  return rows.length > 0;
}

/**
 * The cap for `amountMinor` leaving `fromAccountId` on `date`: From's free money (the balance less every promise on it,
 * as if `excludeTransactionId` — an edit's original — were not there), and the balance it was read at. An account with
 * nothing promised on it caps nothing: there is no promise to follow the money.
 */
export async function dueCapFor(database: Database, ws: WorkspaceContext, fromAccountId: string, amountMinor: number, date: string, excludeTransactionId: string | null = null): Promise<DueCap> {
  const balanceMinor = (await nativeBalances(database, ws, date))[fromAccountId] ?? 0;
  const view = await setAsideView(database, ws, fromAccountId, { date, excludeTransactionId });
  const promiseFollowsAtMost = view ? Math.max(0, amountMinor - Math.max(0, view.freeMinor)) : amountMinor;
  return { fromAccountId, date, balanceMinor, promiseFollowsAtMost };
}

/** Refuses when From's balance moved between reading the free money and writing: the cap would be worked from stale money. */
export async function checkDueCapTx(tx: Db, ws: WorkspaceContext, cap: DueCap): Promise<void> {
  const now = (await nativeBalancesTx(tx, ws, cap.date))[cap.fromAccountId] ?? 0;
  if (now !== cap.balanceMinor) throw new BalancesChangedError();
}

/** Whether `transactionId` is the transfer a goal's due month posted (or the edit standing in for it now). */
export async function isDueTransferTx(db: Db, ws: WorkspaceContext, transactionId: string): Promise<boolean> {
  if (!(await dueMonthsExist(db))) return false;
  const rows = await db.values(
    sql`SELECT 1 FROM goal_due_months WHERE transaction_id = ${transactionId} AND workspace_id = ${ws.workspaceId} AND mode = 'transfer' LIMIT 1`,
  );
  return rows.length > 0;
}

/** An edit's cap, read before its transaction: null unless the edited transaction is a due month's transfer. */
export async function dueCapForEdit(database: Database, ws: WorkspaceContext, transactionId: string, input: { occurredOn: string; lines: readonly MoneyLine[] }): Promise<DueCap | null> {
  if (!(await isDueTransferTx(database.db, ws, transactionId))) return null;
  const move = await taggedMoveOfTx(database.db, ws, input.occurredOn, input.lines);
  if (!move) return null;
  return dueCapFor(database, ws, move.fromAccountId, move.amountMinor, input.occurredOn, transactionId);
}

/**
 * Points a due month at the edit that replaced its transfer, with what the edit now moves, so Month history says it.
 * An edit that is no longer a transfer keeps the month's figures as they were.
 */
export async function relinkDueMonthTx(tx: Db, ws: WorkspaceContext, fromTransactionId: string, toTransactionId: string, move: TaggedMove | null): Promise<void> {
  if (!(await dueMonthsExist(tx))) return;
  if (move) {
    await tx.run(sql`UPDATE goal_due_months SET transaction_id = ${toTransactionId}, amount_minor = ${move.amountMinor}, account_id = ${move.fromAccountId}, to_account_id = ${move.toAccountId}
      WHERE transaction_id = ${fromTransactionId} AND workspace_id = ${ws.workspaceId}`);
  } else {
    await tx.run(sql`UPDATE goal_due_months SET transaction_id = ${toTransactionId} WHERE transaction_id = ${fromTransactionId} AND workspace_id = ${ws.workspaceId}`);
  }
}
