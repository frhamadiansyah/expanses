import { addMonths, daysInMonth, monthName, monthOf } from '@expanses/core';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, transactions } from '../schema';
import { goalDueMonths, goalDues, goals } from '../schema-goals';
import { MONEY_SUBTYPES } from './accounts';
import { recordContributionTx } from './goal-contributions';
import { GoalDbError } from './goals';
import { recordTaggedTransferTx } from './goal-transfers';
import { voidTransactionTx } from './ledger';
import { adjustSetAsideTx, isPocketParentTx, lowerSetAsideTx } from './set-aside-tx';

/*
 * A goal's Monthly that comes due like a bill (owner, 12 Nov 2026). Turned on, each month from the month it was turned
 * on waits for a tap: Set aside (the goal's promise on an account grows; nothing is posted), Transfer (a real transfer,
 * tagged to the goal, through the tagged-transfer path) or Skip. Nothing happens by itself.
 *
 * goal_dues and goal_due_months are this phone's own and never synced (0111): on a shared goal each phone keeps its own
 * months for its own person, and the set-aside or transfer goes through the paths that already sync.
 */

export type GoalDueMode = 'set_aside' | 'transfer';
export type GoalDueState = 'open' | 'done' | 'skipped';

/** The day picker's "Last day": every month comes due on its own last day. */
export const LAST_DAY = 31;

export interface GoalDueSettings {
  goalId: string;
  /** 1–31; a month shorter than the day comes due on its last day. */
  day: number;
  mode: GoalDueMode;
  /** Set aside: the account the money is promised in. Transfer: the account it leaves. */
  accountId: string | null;
  /** Transfer only: the account it lands in. */
  toAccountId: string | null;
  /** YYYY-MM: the first month due, the month the switch was last turned on. */
  startedMonth: string;
  active: boolean;
}

/** What was done with one month, as stored. `live` is whether a transfer month's transfer still stands. */
export interface GoalDueRecord {
  month: string;
  state: 'done' | 'skipped';
  mode: GoalDueMode | null;
  amountMinor: number | null;
  occurredOn: string | null;
  accountId: string | null;
  toAccountId: string | null;
  transactionId: string | null;
  live: boolean;
}

export interface GoalDueMonth {
  goalId: string;
  month: string;
  /** The day it comes due, the due day clamped to the month. */
  dueOn: string;
  state: GoalDueState;
  mode: GoalDueMode;
  /** Done: what was set aside or transferred. Open: the goal's Monthly. Skipped: the Monthly it would have been. */
  amountMinor: number;
  /** Done only: the day it was set aside or transferred. */
  occurredOn: string | null;
  accountId: string | null;
  toAccountId: string | null;
  /** A transfer month only: the transfer it posted (the latest edit of it). */
  transactionId: string | null;
}

export interface GoalDue {
  settings: GoalDueSettings;
  /** Newest first: every month from the start to this one, and any done or skipped month before it. */
  months: GoalDueMonth[];
}

export class GoalDueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoalDueError';
  }
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The day a month comes due: the due day, or the month's last day when the month is shorter (29–31, "Last day"). */
export function dueDayOn(month: string, day: number): string {
  const [year, month1] = month.split('-').map(Number) as [number, number];
  const clamped = Math.min(Math.max(1, day), daysInMonth(year, month1));
  return `${month}-${String(clamped).padStart(2, '0')}`;
}

/**
 * Every month a goal has due, newest first. While on, each month from the start to `currentMonth` is there, open
 * unless a record says otherwise; a done or skipped month from before (the switch turned off and on again) stays.
 * A transfer month whose transfer was voided elsewhere is open again.
 */
export function dueMonthsOf(goalId: string, settings: GoalDueSettings, records: readonly GoalDueRecord[], monthlyMinor: number, currentMonth: string): GoalDueMonth[] {
  const byMonth = new Map(records.map((record) => [record.month, record]));
  const months = new Set(records.map((record) => record.month).filter((month) => month <= currentMonth));
  if (settings.active) {
    for (let month = settings.startedMonth; month <= currentMonth; month = addMonths(month, 1)) months.add(month);
  }
  return [...months]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((month): GoalDueMonth => {
      const record = byMonth.get(month);
      const dueOn = dueDayOn(month, settings.day);
      const open: GoalDueMonth = {
        goalId,
        month,
        dueOn,
        state: 'open',
        mode: settings.mode,
        amountMinor: monthlyMinor,
        occurredOn: null,
        accountId: settings.accountId,
        toAccountId: settings.mode === 'transfer' ? settings.toAccountId : null,
        transactionId: null,
      };
      if (!record) return open;
      if (record.state === 'skipped') return { ...open, state: 'skipped' };
      if (record.mode === 'transfer' && !record.live) return open;
      return {
        goalId,
        month,
        dueOn,
        state: 'done',
        mode: record.mode ?? settings.mode,
        amountMinor: record.amountMinor ?? 0,
        occurredOn: record.occurredOn,
        accountId: record.accountId,
        toAccountId: record.toAccountId,
        transactionId: record.transactionId,
      };
    });
}

/** The transfer standing for `transactionId` now: itself while posted, else the posted edit that replaced it, else null. */
async function liveTransactionTx(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<string | null> {
  let id: string | null = transactionId;
  for (let hop = 0; id !== null && hop < 50; hop += 1) {
    const [row] = await tx
      .select({ status: transactions.status })
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.workspaceId, ws.workspaceId)));
    if (!row) return null;
    if (row.status === 'posted') return id;
    const [next] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.replacesTransactionId, id), eq(transactions.workspaceId, ws.workspaceId)));
    id = next?.id ?? null;
  }
  return null;
}

const tablesExist = new WeakMap<Db, boolean>();

/** Whether 0111 has run on this database: one stopped before it has no dues, and reads them as none. */
async function dueTablesExist(db: Db): Promise<boolean> {
  if (tablesExist.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'goal_dues'`);
  if (rows.length > 0) tablesExist.set(db, true);
  return rows.length > 0;
}

function settingsOf(row: typeof goalDues.$inferSelect): GoalDueSettings {
  return {
    goalId: row.goalId,
    day: row.day,
    mode: row.mode,
    accountId: row.accountId,
    toAccountId: row.toAccountId,
    startedMonth: row.startedMonth,
    active: row.active === 1,
  };
}

async function recordsOfTx(tx: Db, ws: WorkspaceContext, goalId: string): Promise<GoalDueRecord[]> {
  const rows = await tx
    .select()
    .from(goalDueMonths)
    .where(and(eq(goalDueMonths.goalId, goalId), eq(goalDueMonths.workspaceId, ws.workspaceId)));
  const records: GoalDueRecord[] = [];
  for (const row of rows) {
    const live = row.transactionId ? await liveTransactionTx(tx, ws, row.transactionId) : null;
    records.push({
      month: row.month,
      state: row.state,
      mode: row.mode,
      amountMinor: row.amountMinor,
      occurredOn: row.occurredOn,
      accountId: row.accountId,
      toAccountId: row.toAccountId,
      transactionId: live ?? row.transactionId,
      live: row.mode !== 'transfer' || live !== null,
    });
  }
  return records;
}

/**
 * Every goal with Due each month set, with its months up to `today`'s. Only active goals: archiving or deleting a goal
 * ends its dues.
 */
export async function listGoalDues(database: Database, ws: WorkspaceContext, today: string): Promise<GoalDue[]> {
  if (!(await dueTablesExist(database.db))) return [];
  const tx = database.db;
  {
    const rows = await tx
      .select({ due: goalDues, monthlyMinor: goals.standingMonthlyMinor, status: goals.status })
      .from(goalDues)
      .innerJoin(goals, and(eq(goals.id, goalDues.goalId), eq(goals.workspaceId, goalDues.workspaceId)))
      .where(eq(goalDues.workspaceId, ws.workspaceId));
    const result: GoalDue[] = [];
    for (const row of rows) {
      if (row.status !== 'active') continue;
      const settings = settingsOf(row.due);
      const records = await recordsOfTx(tx, ws, settings.goalId);
      result.push({ settings, months: dueMonthsOf(settings.goalId, settings, records, row.monthlyMinor, monthOf(today)) });
    }
    return result;
  }
}

export interface SaveGoalDueInput {
  goalId: string;
  /** The "Due each month" switch. Off keeps the rest, and the months already done or skipped. */
  on: boolean;
  day: number;
  mode: GoalDueMode;
  accountId: string | null;
  toAccountId: string | null;
}

async function assertGoalTx(tx: Db, ws: WorkspaceContext, goalId: string): Promise<{ name: string; standingMonthlyMinor: number }> {
  const [goal] = await tx
    .select({ name: goals.name, status: goals.status, standingMonthlyMinor: goals.standingMonthlyMinor })
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.workspaceId, ws.workspaceId)));
  if (!goal || goal.status === 'archived') throw new GoalDbError('Goal not found in this workspace');
  return goal;
}

/** The set-aside rule `saveEarmark` keeps: an account that holds money of its own, in this workspace. */
async function assertSetAsideAccountTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<void> {
  const [account] = await tx
    .select({ subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) throw new GoalDueError('Account not found in this workspace');
  if (!MONEY_SUBTYPES.includes(account.subtype)) throw new GoalDueError('Only accounts that hold money can be set aside');
  if (await isPocketParentTx(tx, ws, accountId)) throw new GoalDueError('That account holds no money of its own. Set aside on one of its pockets.');
}

async function assertAccountTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<void> {
  const [account] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) throw new GoalDueError('Account not found in this workspace');
}

/**
 * Writes a goal's Due each month. Turned on from off (or for the first time), the first month due is `today`'s month;
 * changed while on, the start stays. Turned off, nothing more comes due and what was done stays done.
 */
export async function saveGoalDue(database: Database, ws: WorkspaceContext, input: SaveGoalDueInput, today: string): Promise<void> {
  if (!DATE.test(today)) throw new GoalDueError('A date is YYYY-MM-DD');
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > LAST_DAY) throw new GoalDueError('Choose a day of the month');
  await database.transaction(async (tx) => {
    await assertGoalTx(tx, ws, input.goalId);
    const [existing] = await tx
      .select()
      .from(goalDues)
      .where(and(eq(goalDues.goalId, input.goalId), eq(goalDues.workspaceId, ws.workspaceId)));
    const now = new Date().toISOString();
    if (!input.on) {
      if (existing) await tx.update(goalDues).set({ active: 0, updatedAt: now }).where(eq(goalDues.goalId, input.goalId));
      return;
    }
    if (!input.accountId) throw new GoalDueError(input.mode === 'set_aside' ? 'Choose an account to set it aside in' : 'Choose the account it leaves');
    if (input.mode === 'set_aside') await assertSetAsideAccountTx(tx, ws, input.accountId);
    else {
      if (!input.toAccountId) throw new GoalDueError('Choose the account it goes to');
      if (input.toAccountId === input.accountId) throw new GoalDueError('Choose two different accounts');
      await assertAccountTx(tx, ws, input.accountId);
      await assertAccountTx(tx, ws, input.toAccountId);
    }
    const row = {
      goalId: input.goalId,
      workspaceId: ws.workspaceId,
      day: input.day,
      mode: input.mode,
      accountId: input.accountId,
      toAccountId: input.mode === 'transfer' ? input.toAccountId : null,
      startedMonth: existing?.active === 1 ? existing.startedMonth : monthOf(today),
      active: 1,
      updatedAt: now,
    };
    if (existing) await tx.update(goalDues).set(row).where(eq(goalDues.goalId, input.goalId));
    else await tx.insert(goalDues).values(row);
  });
}

/** One goal's Due each month as stored, or null when it was never set. */
export async function goalDueOf(database: Database, ws: WorkspaceContext, goalId: string): Promise<GoalDueSettings | null> {
  if (!(await dueTablesExist(database.db))) return null;
  const [row] = await database.db
    .select()
    .from(goalDues)
    .where(and(eq(goalDues.goalId, goalId), eq(goalDues.workspaceId, ws.workspaceId)));
  return row ? settingsOf(row) : null;
}

async function settingsTx(tx: Db, ws: WorkspaceContext, goalId: string): Promise<GoalDueSettings> {
  const [row] = await tx
    .select()
    .from(goalDues)
    .where(and(eq(goalDues.goalId, goalId), eq(goalDues.workspaceId, ws.workspaceId)));
  if (!row) throw new GoalDueError('This goal has no Monthly due');
  return settingsOf(row);
}

/** The month as it stands now (open, done or skipped), refusing one that is not due: before the start, or ahead. */
async function monthTx(tx: Db, ws: WorkspaceContext, goalId: string, month: string, today: string): Promise<{ settings: GoalDueSettings; record: GoalDueRecord | null; state: GoalDueState }> {
  if (!MONTH.test(month)) throw new GoalDueError('A month is YYYY-MM');
  const settings = await settingsTx(tx, ws, goalId);
  const record = (await recordsOfTx(tx, ws, goalId)).find((row) => row.month === month) ?? null;
  const due = settings.active && month >= settings.startedMonth && month <= monthOf(today);
  if (!due && !record) throw new GoalDueError(`${monthName(month, 'long')} is not due`);
  const state: GoalDueState = !record ? 'open' : record.state === 'skipped' ? 'skipped' : record.mode === 'transfer' && !record.live ? 'open' : 'done';
  return { settings, record, state };
}

async function writeRecordTx(tx: Db, ws: WorkspaceContext, goalId: string, month: string, row: Omit<typeof goalDueMonths.$inferInsert, 'goalId' | 'workspaceId' | 'month' | 'createdAt'>): Promise<void> {
  await tx.delete(goalDueMonths).where(and(eq(goalDueMonths.goalId, goalId), eq(goalDueMonths.month, month), eq(goalDueMonths.workspaceId, ws.workspaceId)));
  await tx.insert(goalDueMonths).values({ goalId, workspaceId: ws.workspaceId, month, createdAt: new Date().toISOString(), ...row });
}

function assertAmount(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new GoalDueError('Enter an amount greater than zero');
}

export interface SetAsideGoalMonthInput {
  goalId: string;
  month: string;
  amountMinor: number;
  accountId: string;
  /** The day it was set aside. */
  occurredOn: string;
}

/**
 * Sets a month aside: the goal's promise on the account grows by the amount, as the goal's own Set aside does, and
 * nothing is posted. A skipped month can be set aside after all; a done one is undone first.
 */
export async function setAsideGoalMonth(database: Database, ws: WorkspaceContext, input: SetAsideGoalMonthInput): Promise<void> {
  assertAmount(input.amountMinor);
  if (!DATE.test(input.occurredOn)) throw new GoalDueError('A date is YYYY-MM-DD');
  await database.transaction(async (tx) => {
    await assertGoalTx(tx, ws, input.goalId);
    const { state } = await monthTx(tx, ws, input.goalId, input.month, input.occurredOn);
    if (state === 'done') throw new GoalDueError(`${monthName(input.month, 'long')} is already done`);
    await assertSetAsideAccountTx(tx, ws, input.accountId);
    await adjustSetAsideTx(tx, ws, input.goalId, input.accountId, input.amountMinor);
    await recordContributionTx(tx, ws, input.goalId, input.accountId, input.amountMinor);
    await writeRecordTx(tx, ws, input.goalId, input.month, {
      state: 'done',
      mode: 'set_aside',
      amountMinor: input.amountMinor,
      occurredOn: input.occurredOn,
      accountId: input.accountId,
      toAccountId: null,
      transactionId: null,
    });
  });
}

export interface TransferGoalMonthInput {
  goalId: string;
  month: string;
  amountMinor: number;
  fromAccountId: string;
  toAccountId: string;
  occurredOn: string;
  /** What landed, when the two accounts are in different currencies (as `recordTaggedTransfer` asks). */
  toAmountMinor?: number | null;
  ratesToBase?: Record<string, number>;
}

/**
 * Transfers a month: a real transfer through the tagged-transfer path, tagged to the goal, so the goal's set-aside
 * follows the money to the destination as any transfer into a goal does. Returns the transfer's id.
 */
export async function transferGoalMonth(database: Database, ws: WorkspaceContext, input: TransferGoalMonthInput): Promise<string> {
  assertAmount(input.amountMinor);
  if (!DATE.test(input.occurredOn)) throw new GoalDueError('A date is YYYY-MM-DD');
  return database.transaction(async (tx) => {
    const goal = await assertGoalTx(tx, ws, input.goalId);
    const { state } = await monthTx(tx, ws, input.goalId, input.month, input.occurredOn);
    if (state === 'done') throw new GoalDueError(`${monthName(input.month, 'long')} is already done`);
    const { transactionId } = await recordTaggedTransferTx(tx, ws, {
      occurredOn: input.occurredOn,
      description: `${goal.name} · ${monthName(input.month, 'long')}`,
      amountMinor: input.amountMinor,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      toAmountMinor: input.toAmountMinor ?? null,
      goalId: input.goalId,
      ratesToBase: input.ratesToBase,
    });
    await writeRecordTx(tx, ws, input.goalId, input.month, {
      state: 'done',
      mode: 'transfer',
      amountMinor: input.amountMinor,
      occurredOn: input.occurredOn,
      accountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      transactionId,
    });
    return transactionId;
  });
}

/** Skips a month: nothing is set aside or moved. A done month is undone first. */
export async function skipGoalMonth(database: Database, ws: WorkspaceContext, goalId: string, month: string, today: string): Promise<void> {
  await database.transaction(async (tx) => {
    await assertGoalTx(tx, ws, goalId);
    const { state } = await monthTx(tx, ws, goalId, month, today);
    if (state === 'done') throw new GoalDueError(`${monthName(month, 'long')} is already done`);
    await writeRecordTx(tx, ws, goalId, month, { state: 'skipped', mode: null, amountMinor: null, occurredOn: null, accountId: null, toAccountId: null, transactionId: null });
  });
}

/**
 * Undoes a month, exactly: a set-aside comes off the goal's promise on its account (never below nought, if some of it
 * has been used since), a transfer is voided (its latest edit, if it was edited), a skip is cleared. The month is open
 * again.
 */
export async function undoGoalMonth(database: Database, ws: WorkspaceContext, goalId: string, month: string): Promise<void> {
  await database.transaction(async (tx) => {
    const records = await recordsOfTx(tx, ws, goalId);
    const record = records.find((row) => row.month === month);
    if (!record) return;
    if (record.state === 'done' && record.mode === 'set_aside' && record.accountId && (record.amountMinor ?? 0) > 0) {
      const taken = await lowerSetAsideTx(tx, ws, goalId, record.accountId, record.amountMinor!);
      await recordContributionTx(tx, ws, goalId, record.accountId, -taken);
    }
    if (record.state === 'done' && record.mode === 'transfer' && record.live && record.transactionId) {
      await voidTransactionTx(tx, ws, record.transactionId);
    }
    await tx.delete(goalDueMonths).where(and(eq(goalDueMonths.goalId, goalId), eq(goalDueMonths.month, month), eq(goalDueMonths.workspaceId, ws.workspaceId)));
  });
}

/** Changes what a set-aside month set aside: the goal's promise on its account moves by the difference. */
export async function changeGoalMonthAmount(database: Database, ws: WorkspaceContext, goalId: string, month: string, amountMinor: number): Promise<void> {
  assertAmount(amountMinor);
  await database.transaction(async (tx) => {
    const record = (await recordsOfTx(tx, ws, goalId)).find((row) => row.month === month);
    if (!record || record.state !== 'done') throw new GoalDueError(`Nothing was set aside for ${monthName(month, 'long')}`);
    if (record.mode !== 'set_aside' || !record.accountId) throw new GoalDueError('A transfer is changed on the transfer itself');
    const delta = amountMinor - (record.amountMinor ?? 0);
    if (delta > 0) {
      await adjustSetAsideTx(tx, ws, goalId, record.accountId, delta);
      await recordContributionTx(tx, ws, goalId, record.accountId, delta);
    } else if (delta < 0) {
      const taken = await lowerSetAsideTx(tx, ws, goalId, record.accountId, -delta);
      await recordContributionTx(tx, ws, goalId, record.accountId, -taken);
    }
    await tx
      .update(goalDueMonths)
      .set({ amountMinor })
      .where(and(eq(goalDueMonths.goalId, goalId), eq(goalDueMonths.month, month), eq(goalDueMonths.workspaceId, ws.workspaceId)));
  });
}
