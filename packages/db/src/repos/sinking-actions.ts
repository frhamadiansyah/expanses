import { addMonths, formatMinor, isoDate, monthOf, sinkingExtraPreview, sinkingHistory, type SinkingHistoryRow, sinkingRecalc } from '@expanses/core';
import { eq, and } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { RecurringError } from './expense-templates';
import { nativeBalances } from './ledger';
import { setAsideView } from './set-aside';
import { addSinkingExtra, setSinkingSkip, writeSinkingPlan } from './sinking-funds';
import { sinkingFactsOf, sinkingFundOf } from './sinking-views';

/*
 * What a sinking fund does when something changes: money put in, a month skipped or added back. Each recalculates the
 * monthly figure (core's sinkingRecalc) unless the owner typed one, and money put in is refused when the account does
 * not hold it free. The check is for NOW only, never for the months to come: later months are a plan, and a plan that
 * outgrows the account shows up as a shortage on the set-aside view, the way every other fund does.
 */

export interface FundRoom {
  accountName: string;
  currency: string;
  /** The balance minus every other promise (goals, other funds), signed. */
  freeMinor: number;
}

/**
 * The account's free money now, leaving out `excludingBillId`'s own claim (its fund is the thing being asked about, so
 * what it already holds there is not "taken").
 */
export async function fundRoom(database: Database, ws: WorkspaceContext, accountId: string, today: string, excludingBillId?: string): Promise<FundRoom | null> {
  const [account] = await database.db
    .select({ name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) return null;
  const view = await setAsideView(database, ws, accountId, { date: today });
  const balance = view ? view.freeMinor : ((await nativeBalances(database, ws, today))[accountId] ?? 0);
  const own = excludingBillId ? (view?.funds.find((fund) => fund.billId === excludingBillId)?.promisedMinor ?? 0) : 0;
  return { accountName: account.name, currency: account.currency ?? ws.baseCurrency, freeMinor: balance + own };
}

/** The refusal text: `<Account> has <Rp X> free. This fund needs <Rp Y> now.` */
export function fundShortMessage(room: FundRoom, needsMinor: number): string {
  return `${room.accountName} has ${formatMinor(Math.max(0, room.freeMinor), room.currency)} free. This fund needs ${formatMinor(needsMinor, room.currency)} now.`;
}

export async function putInSinkingExtra(
  database: Database,
  ws: WorkspaceContext,
  billId: string,
  input: { amountMinor: number; date?: string; keepMonthly?: boolean; today?: string },
): Promise<void> {
  const today = input.today ?? isoDate();
  const fund = await sinkingFundOf(database, ws, billId, today);
  if (!fund) throw new RecurringError('NO_FUND', 'This bill has no sinking fund');
  if (!(Number.isSafeInteger(input.amountMinor) && input.amountMinor > 0)) throw new RecurringError('FUND_EXTRA', 'Enter the amount to put in');
  const preview = sinkingExtraPreview(sinkingFactsOf(fund), fund.targetMinor, fund.dueMonth, today, fund.currency, input.amountMinor, Boolean(input.keepMonthly));
  const room = await fundRoom(database, ws, fund.accountId, today);
  // Money past the bill is not promised (the fund stops at the bill), so only what it adds is checked.
  if (room && preview.promisedMinor > room.freeMinor) throw new RecurringError('FUND_SHORT', fundShortMessage(room, preview.promisedMinor));
  await database.transaction(async (tx) => {
    await addSinkingExtra(tx, ws, billId, input.amountMinor, input.date ?? today);
    // Kept at the old figure, or the new one from next month (the month that is running is settled).
    const from = addMonths(monthOf(today) > fund.startedMonth ? monthOf(today) : fund.startedMonth, 1);
    await writeSinkingPlan(tx, ws, billId, from, preview.monthlyMinor, Boolean(input.keepMonthly), today);
  });
}

/** Skips a begun month, or adds it again, then recalculates the monthly figure unless a custom one was typed. */
export async function setSinkingMonthSkipped(database: Database, ws: WorkspaceContext, billId: string, month: string, skipped: boolean, today: string = isoDate()): Promise<void> {
  const fund = await sinkingFundOf(database, ws, billId, today);
  if (!fund) throw new RecurringError('NO_FUND', 'This bill has no sinking fund');
  if (!fund.months.some((m) => m.month === month)) throw new RecurringError('FUND_MONTH', 'Only a month already begun can be skipped');
  await database.transaction(async (tx) => {
    await setSinkingSkip(tx, ws, billId, month, skipped, today);
    if (fund.custom) return;
    const entries = fund.entries.filter((e) => !(e.kind === 'skip' && e.month === month));
    const next = { ...sinkingFactsOf(fund), entries: skipped ? [...entries, { id: 'skip', kind: 'skip' as const, month, amountMinor: 0, occurredOn: today }] : entries };
    const r = sinkingRecalc(next, fund.targetMinor, fund.dueMonth, today, fund.currency, 'next');
    await writeSinkingPlan(tx, ws, billId, r.effectiveFrom, r.monthlyMinor, null, today);
  });
}

export interface SinkingHistory {
  rows: SinkingHistoryRow[];
  savedMinor: number;
  targetMinor: number;
  currency: string;
  name: string;
}

export async function sinkingHistoryOf(database: Database, ws: WorkspaceContext, billId: string, today: string = isoDate()): Promise<SinkingHistory | null> {
  const fund = await sinkingFundOf(database, ws, billId, today);
  if (!fund) return null;
  const rows = sinkingHistory(sinkingFactsOf(fund), fund.targetMinor, fund.dueMonth, today);
  return { rows, savedMinor: fund.savedMinor, targetMinor: fund.targetMinor, currency: fund.currency, name: fund.name };
}
