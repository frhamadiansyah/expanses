import { type AccountSetAside, type BorrowMark, type SetAsideClaim, setAsideOn } from '@expanses/core';
import { and, eq, inArray, lte, type SQL } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { goalDraws } from '../schema-goals';
import { listEarmarks, listGoals } from './goals';
import { nativeBalances } from './ledger';
import { type SetAsideChoice, setAsideChoiceOfTx, type SetAsideIntent, setAsideTablesExist } from './set-aside-tx';

export interface AccountSetAsideRow extends AccountSetAside {
  accountId: string;
  name: string;
  currency: string;
}

export interface SetAsideViewOptions {
  /** Balances and borrows up to this day; everything recorded when absent. */
  date?: string;
  /** Show the accounts as if this transaction had not been recorded — how an edit asks about itself. */
  excludeTransactionId?: string | null;
}

export interface DrawRow {
  id: string;
  transactionId: string;
  goalId: string;
  accountId: string;
  intent: SetAsideIntent;
  amountMinor: number;
  toAccountId: string | null;
  toAmountMinor: number | null;
  stageId: string | null;
  wasWhole: boolean;
  wholeSince: string | null;
  occurredOn: string;
  createdAt: string;
  /** The transaction's own description, for the goal's history. */
  description: string;
}

/** Every answer on a posted transaction. Voided ones are gone already (`undoSetAsideTx`); the join is belt and braces. */
export async function listDraws(database: Database, ws: WorkspaceContext, upTo?: string): Promise<DrawRow[]> {
  if (!(await setAsideTablesExist(database.db))) return [];
  const conds: SQL[] = [eq(goalDraws.workspaceId, ws.workspaceId), eq(transactions.status, 'posted')];
  if (upTo) conds.push(lte(goalDraws.occurredOn, upTo));
  const rows = await database.db
    .select({ draw: goalDraws, description: transactions.description })
    .from(goalDraws)
    .innerJoin(transactions, eq(transactions.id, goalDraws.transactionId))
    .where(and(...conds));
  return rows.map(({ draw, description }) => ({
    id: draw.id,
    transactionId: draw.transactionId,
    goalId: draw.goalId,
    accountId: draw.accountId,
    intent: draw.intent,
    amountMinor: draw.amountMinor,
    toAccountId: draw.toAccountId,
    toAmountMinor: draw.toAmountMinor,
    stageId: draw.stageId,
    wasWhole: draw.wasWhole === 1,
    wholeSince: draw.wholeSince,
    occurredOn: draw.occurredOn,
    createdAt: draw.createdAt,
    description,
  }));
}

/** Every account something is promised on, shared out (`setAsideOn`). Archived goals promise nothing. */
export async function setAsideViews(database: Database, ws: WorkspaceContext, opts: SetAsideViewOptions = {}): Promise<Record<string, AccountSetAsideRow>> {
  const goals = await listGoals(database, ws);
  if (goals.length === 0) return {};
  const active = new Map(goals.map((goal) => [goal.id, goal]));
  const promised = new Map<string, Map<string, number>>();
  const add = (accountId: string, goalId: string, minor: number) => {
    const byGoal = promised.get(accountId) ?? new Map<string, number>();
    byGoal.set(goalId, (byGoal.get(goalId) ?? 0) + minor);
    promised.set(accountId, byGoal);
  };
  for (const earmark of await listEarmarks(database, ws)) if (active.has(earmark.goalId)) add(earmark.accountId, earmark.goalId, earmark.amountMinor);

  const excluded = opts.excludeTransactionId ?? null;
  // Every answer, whatever its date: a promise is not dated, so a future-dated spend lowered it today and leaving that
  // spend out has to give it back today. Only the borrows that order the share-out stop at `date`.
  const allDraws = await listDraws(database, ws);
  const draws = opts.date ? allDraws.filter((draw) => draw.occurredOn <= opts.date!) : allDraws;
  for (const draw of allDraws) {
    if (draw.transactionId !== excluded || !active.has(draw.goalId)) continue;
    // What the excluded transaction did to promises, undone — the same arithmetic undoSetAsideTx performs.
    if (draw.intent === 'spend') add(draw.accountId, draw.goalId, draw.amountMinor);
    if (draw.intent === 'move') {
      add(draw.accountId, draw.goalId, draw.amountMinor);
      if (draw.toAccountId && draw.toAmountMinor) add(draw.toAccountId, draw.goalId, -draw.toAmountMinor);
    }
  }
  if (promised.size === 0) return {};

  const balances = await nativeBalances(database, ws, opts.date);
  if (excluded) {
    // Only what `nativeBalances` counted can be taken back off it: a transaction dated after `date` is not in the
    // balance, and subtracting it anyway would count it twice in the other direction.
    const conds: SQL[] = [eq(entries.workspaceId, ws.workspaceId), eq(entries.transactionId, excluded), eq(transactions.status, 'posted')];
    if (opts.date) conds.push(lte(transactions.occurredOn, opts.date));
    const lines = await database.db
      .select({ accountId: entries.accountId, amountMinor: entries.amountMinor })
      .from(entries)
      .innerJoin(transactions, eq(transactions.id, entries.transactionId))
      .where(and(...conds));
    for (const line of lines) balances[line.accountId] = (balances[line.accountId] ?? 0) - line.amountMinor;
  }

  const rows = await database.db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), inArray(accounts.id, [...promised.keys()])));
  const views: Record<string, AccountSetAsideRow> = {};
  for (const account of rows) {
    const claims: SetAsideClaim[] = [...promised.get(account.id)!].map(([goalId, minor]) => ({
      goalId,
      name: active.get(goalId)!.name,
      rank: active.get(goalId)!.rank,
      promisedMinor: Math.max(0, minor),
    }));
    const borrows: BorrowMark[] = draws
      .filter((draw) => draw.intent === 'borrow' && draw.accountId === account.id && draw.transactionId !== excluded)
      .map((draw) => ({ goalId: draw.goalId, amountMinor: draw.amountMinor, occurredOn: draw.occurredOn, createdAt: draw.createdAt }));
    views[account.id] = {
      accountId: account.id,
      name: account.name,
      currency: account.currency ?? ws.baseCurrency,
      ...setAsideOn(balances[account.id] ?? 0, claims, borrows),
    };
  }
  return views;
}

export async function setAsideView(database: Database, ws: WorkspaceContext, accountId: string, opts: SetAsideViewOptions = {}): Promise<AccountSetAsideRow | null> {
  return (await setAsideViews(database, ws, opts))[accountId] ?? null;
}

/** The answer a transaction was saved with, for an edit form to open on. */
export async function setAsideChoiceOf(database: Database, ws: WorkspaceContext, transactionId: string): Promise<SetAsideChoice | null> {
  return (await setAsideTablesExist(database.db)) ? setAsideChoiceOfTx(database.db, ws, transactionId) : null;
}
