import { daysFrom, instalmentDates, type InstalmentState, instalmentStanding, monthOf, monthRange, type ScheduleRow } from '@expanses/core';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { calculatorInputs } from '../schema-health';
import { categoryIdsByKeyAllTx } from './categories';
import { healthTablesExist } from './health-tables';
import { listLoans, loanOwedOn, scheduleFor } from './loans';

export interface DebtMovement {
  transactionId: string;
  accountId: string;
  occurredOn: string;
  /** Positive: the debt went down (a payment). Negative: it went up (borrowing, a charge, an opening balance). Account currency. */
  amountMinor: number;
  /** Every expense line in the same transaction (interest, insurance, admin), summed. */
  chargesMinor: number;
  /** Lines under the `miscellaneous.interest` category (any book's copy). */
  interestMinor: number;
  fromMessage: boolean;
}

/**
 * Every posted movement on these debt accounts, one row per transaction and account, with the expense lines riding on
 * the same transaction. A liability's entry is positive when it falls, the sign `loanPayments` reads.
 */
/** How many ids one statement binds; the other repos' lists keep to the same few hundred. */
export const DEBT_ID_CHUNK = 500;

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += DEBT_ID_CHUNK) out.push(list.slice(i, i + DEBT_ID_CHUNK));
  return out;
}

export async function debtMovements(
  database: Database,
  ws: WorkspaceContext,
  accountIds: readonly string[],
  range?: { from?: string; to?: string },
): Promise<DebtMovement[]> {
  if (accountIds.length === 0) return [];
  const rows: { transactionId: string; accountId: string; amountMinor: number; occurredOn: string; source: string }[] = [];
  // Bound parameters are capped per statement (32.766 on the device's SQLite): every id list goes in chunks.
  for (const ids of chunks([...new Set(accountIds)])) {
    const where = [eq(entries.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), inArray(entries.accountId, ids)];
    if (range?.from) where.push(gte(transactions.occurredOn, range.from));
    if (range?.to) where.push(lte(transactions.occurredOn, range.to));
    rows.push(
      ...(await database.db
        .select({ transactionId: entries.transactionId, accountId: entries.accountId, amountMinor: entries.amountMinor, occurredOn: transactions.occurredOn, source: transactions.source })
        .from(entries)
        .innerJoin(transactions, eq(entries.transactionId, transactions.id))
        .where(and(...where))),
    );
  }

  const grouped = new Map<string, DebtMovement>();
  for (const row of rows) {
    const key = `${row.transactionId}|${row.accountId}`;
    const found = grouped.get(key);
    if (found) found.amountMinor += row.amountMinor;
    else grouped.set(key, { transactionId: row.transactionId, accountId: row.accountId, occurredOn: row.occurredOn, amountMinor: row.amountMinor, chargesMinor: 0, interestMinor: 0, fromMessage: row.source === 'email' });
  }
  const movements = [...grouped.values()];
  if (movements.length === 0) return [];

  const transactionIds = [...new Set(movements.map((m) => m.transactionId))];
  const interestIds = new Set((await categoryIdsByKeyAllTx(database.db, ws))['miscellaneous.interest'] ?? []);
  const lines: { transactionId: string; accountId: string; amountMinor: number }[] = [];
  for (const ids of chunks(transactionIds)) {
    lines.push(
      ...(await database.db
        .select({ transactionId: entries.transactionId, accountId: entries.accountId, amountMinor: entries.amountMinor })
        .from(entries)
        .innerJoin(accounts, eq(entries.accountId, accounts.id))
        .where(and(eq(entries.workspaceId, ws.workspaceId), eq(accounts.kind, 'expense'), inArray(entries.transactionId, ids)))),
    );
  }
  const charges = new Map<string, { charges: number; interest: number }>();
  for (const line of lines) {
    if (line.amountMinor <= 0) continue;
    const sum = charges.get(line.transactionId) ?? { charges: 0, interest: 0 };
    sum.charges += line.amountMinor;
    if (interestIds.has(line.accountId)) sum.interest += line.amountMinor;
    charges.set(line.transactionId, sum);
  }
  for (const movement of movements) {
    const sum = charges.get(movement.transactionId);
    if (sum) {
      movement.chargesMinor = sum.charges;
      movement.interestMinor = sum.interest;
    }
  }
  return movements.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.transactionId.localeCompare(b.transactionId));
}

export interface LoanPlanFact {
  accountId: string;
  owedMinor: number;
  /** The later of the first payment and the account's first ledger day. */
  trackFrom: string;
  /** Tracked instalments through the end of the current month (spec §6.2). */
  instalments: InstalmentState[];
  /** Today, or next month's 1st when this month's instalment is already paid. */
  scheduleFrom: string;
  schedule: ScheduleRow[];
}

const nextMonthFirst = (today: string): string => {
  const { to } = monthRange(monthOf(today));
  const [year, month] = to.split('-').map(Number);
  return month === 12 ? `${year! + 1}-01-01` : `${year}-${String(month! + 1).padStart(2, '0')}-01`;
};

/** Every open loan with terms: what is owed, how each tracked instalment stands, and the schedule from here. */
export async function loanPlanFacts(database: Database, ws: WorkspaceContext, today: string): Promise<LoanPlanFact[]> {
  const open = (await listLoans(database, ws)).filter((loan) => loan.status === 'open');
  if (open.length === 0) return [];
  const movements = await debtMovements(database, ws, open.map((loan) => loan.accountId));
  const monthEnd = monthRange(monthOf(today)).to;
  const facts: LoanPlanFact[] = [];
  for (const loan of open) {
    const own = movements.filter((m) => m.accountId === loan.accountId);
    const firstDay = own[0]?.occurredOn;
    const trackFrom = firstDay && firstDay > loan.firstPaymentOn ? firstDay : loan.firstPaymentOn;
    const payments = own
      .filter((m) => m.amountMinor > 0)
      .map((m) => ({ id: m.transactionId, occurredOn: m.occurredOn, totalMinor: m.amountMinor + m.chargesMinor, fromMessage: m.fromMessage }));
    const instalments = instalmentStanding(instalmentDates(loan, trackFrom, monthEnd), payments, today);
    const thisMonth = instalments.find((i) => monthOf(i.dueOn) === monthOf(today));
    // This month's instalment fell before the loan was tracked (an existing loan added after its payment day): it was
    // paid before the app knew the loan, so it is never late and is not asked for again — exactly as a paid month.
    const dueThisMonth = instalmentDates(loan, monthRange(monthOf(today)).from, monthEnd)[0];
    const untracked = dueThisMonth !== undefined && dueThisMonth.dueOn < trackFrom;
    const scheduleFrom = thisMonth?.status === 'paid' || untracked ? nextMonthFirst(today) : today;
    facts.push({
      accountId: loan.accountId,
      owedMinor: Math.max(0, await loanOwedOn(database, ws, loan.accountId)),
      trackFrom,
      instalments,
      scheduleFrom,
      schedule: await scheduleFor(database, ws, loan.accountId, scheduleFrom),
    });
  }
  return facts;
}

/**
 * The loans paid off, for the months behind (the Schedule's past months, the Report's bars): each tracked instalment up
 * to the pay-off day. Paying a loan off settles every instalment due by then, so none of them is ever late here — an
 * instalment no single payment matched reads as paid on the pay-off day. No schedule: nothing is owed.
 */
export async function paidOffLoanFacts(database: Database, ws: WorkspaceContext, today: string): Promise<LoanPlanFact[]> {
  const gone = (await listLoans(database, ws)).filter((loan) => loan.status === 'paid_off');
  if (gone.length === 0) return [];
  const movements = await debtMovements(database, ws, gone.map((loan) => loan.accountId));
  return gone.map((loan) => {
    const own = movements.filter((m) => m.accountId === loan.accountId);
    const firstDay = own[0]?.occurredOn;
    const trackFrom = firstDay && firstDay > loan.firstPaymentOn ? firstDay : loan.firstPaymentOn;
    const paidOffOn = loan.statusOn ?? own.at(-1)?.occurredOn ?? today;
    const payments = own
      .filter((m) => m.amountMinor > 0)
      .map((m) => ({ id: m.transactionId, occurredOn: m.occurredOn, totalMinor: m.amountMinor + m.chargesMinor, fromMessage: m.fromMessage }));
    const instalments = instalmentStanding(instalmentDates(loan, trackFrom, paidOffOn), payments, today).map((i) =>
      i.status === 'paid' ? i : { ...i, status: 'paid' as const, paidOn: paidOffOn, daysLate: Math.max(0, daysFrom(i.dueOn, paidOffOn)) },
    );
    return { accountId: loan.accountId, owedMinor: 0, trackFrom, instalments, scheduleFrom: paidOffOn, schedule: [] };
  });
}

export type DebtPlanMethod = 'snowball' | 'avalanche' | 'byHand';

export interface DebtPlanSettings {
  method: DebtPlanMethod | null;
  order: string[];
  extraMinor: number;
  extraCurrency: string | null;
}

export class DebtPlanError extends Error {
  constructor(
    public readonly code: 'NO_TABLES' | 'INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'DebtPlanError';
  }
}

const DEBT_PLAN = 'debt_plan';
const METHODS: readonly DebtPlanMethod[] = ['snowball', 'avalanche', 'byHand'];

/** The plan's order, method and extra, one row per workspace in `calculator_inputs` (0053), replaced whole. */
export async function saveDebtPlanSettings(database: Database, ws: WorkspaceContext, settings: DebtPlanSettings): Promise<void> {
  if (!(await healthTablesExist(database.db))) {
    throw new DebtPlanError('NO_TABLES', 'This database is too old to keep these figures; reopen the app to update it');
  }
  if (!Number.isInteger(settings.extraMinor) || settings.extraMinor < 0) throw new DebtPlanError('INVALID', 'The extra a month must be a whole amount, 0 or more');
  if (new Set(settings.order).size !== settings.order.length) throw new DebtPlanError('INVALID', 'A debt can be in the order only once');
  if (settings.method !== null && !METHODS.includes(settings.method)) throw new DebtPlanError('INVALID', 'Unknown order');
  const kept = { version: 1, method: settings.method, order: [...settings.order], extraMinor: settings.extraMinor, extraCurrency: settings.extraCurrency };
  const row = { workspaceId: ws.workspaceId, kind: DEBT_PLAN, inputsJson: JSON.stringify(kept), updatedAt: new Date().toISOString() };
  await database.db
    .insert(calculatorInputs)
    .values(row)
    .onConflictDoUpdate({ target: [calculatorInputs.workspaceId, calculatorInputs.kind], set: { inputsJson: row.inputsJson, updatedAt: row.updatedAt } });
}

/** What was saved last, or null when nothing was, the row cannot be read, or the database predates 0053. */
export async function getDebtPlanSettings(database: Database, ws: WorkspaceContext): Promise<DebtPlanSettings | null> {
  if (!(await healthTablesExist(database.db))) return null;
  const [row] = await database.db
    .select()
    .from(calculatorInputs)
    .where(and(eq(calculatorInputs.workspaceId, ws.workspaceId), eq(calculatorInputs.kind, DEBT_PLAN)));
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.inputsJson) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const method = METHODS.includes(parsed.method as DebtPlanMethod) ? (parsed.method as DebtPlanMethod) : null;
    const order = Array.isArray(parsed.order) ? parsed.order.filter((key): key is string => typeof key === 'string') : [];
    const extraMinor = Number.isInteger(parsed.extraMinor) && (parsed.extraMinor as number) >= 0 ? (parsed.extraMinor as number) : 0;
    const extraCurrency = typeof parsed.extraCurrency === 'string' ? parsed.extraCurrency : null;
    return { method, order, extraMinor, extraCurrency };
  } catch {
    return null;
  }
}
