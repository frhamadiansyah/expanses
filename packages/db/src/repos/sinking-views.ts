import { isoDate, type SinkingFundFacts, type SinkingMonth, sinkingProgress } from '@expanses/core';
import { eq } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { yearlyBills } from './expense-templates';
import { listSinkingFunds, type SinkingFundRow } from './sinking-funds';

/** The facts core's walk takes, from a fund or its view (whose `monthlyMinor` is the current figure, not the first plan's). */
export function sinkingFactsOf(fund: Pick<SinkingFundRow, 'baseMonthlyMinor' | 'startedMonth' | 'entries'>): SinkingFundFacts {
  return { monthlyMinor: fund.baseMonthlyMinor, startedMonth: fund.startedMonth, entries: fund.entries };
}

export interface SinkingFundView extends SinkingFundRow {
  name: string;
  /** The bill's amount, in the fund account's money (a fund is refused where the two differ). */
  targetMinor: number;
  currency: string;
  accountName: string;
  /** YYYY-MM the bill is next due in. */
  dueMonth: string;
  /** YYYY-MM-DD the bill comes out. */
  dueOn: string;
  /** What is set aside today. */
  savedMinor: number;
  monthsDone: number;
  monthsTotal: number;
  /** Every begun month, oldest first. */
  months: SinkingMonth[];
}

/**
 * Every sinking fund with what it has set aside on `today`. A fund whose bill is gone, paid, skipped, or has no fixed
 * amount sets nothing aside: the rows are released when the bill is paid or deleted, and this is the belt and braces.
 */
export async function sinkingFundViews(database: Database, ws: WorkspaceContext, today: string = isoDate()): Promise<SinkingFundView[]> {
  const funds = await listSinkingFunds(database.db, ws);
  if (funds.length === 0) return [];
  // A fund belongs to the owner, whichever workspace is open.
  const bills = new Map((await yearlyBills(database, ownerScope(ws), today)).map((bill) => [bill.id, bill]));
  const accountRows = await database.db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(eq(accounts.workspaceId, ws.workspaceId));
  const accountsById = new Map(accountRows.map((row) => [row.id, row]));
  const views: SinkingFundView[] = [];
  for (const fund of funds) {
    const bill = bills.get(fund.billId);
    const account = accountsById.get(fund.accountId);
    if (!bill || !account || bill.amountMinor === null || bill.state === 'paid' || bill.state === 'skipped') continue;
    const progress = sinkingProgress(sinkingFactsOf(fund), bill.amountMinor, bill.billMonth, today);
    views.push({
      ...fund,
      name: bill.name,
      targetMinor: bill.amountMinor,
      currency: account.currency ?? ws.baseCurrency,
      accountName: account.name,
      dueMonth: bill.billMonth,
      dueOn: bill.window.opensOn,
      ...progress,
    });
  }
  return views.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.name.localeCompare(b.name));
}

export async function sinkingFundOf(database: Database, ws: WorkspaceContext, billId: string, today: string = isoDate()): Promise<SinkingFundView | null> {
  return (await sinkingFundViews(database, ws, today)).find((view) => view.billId === billId) ?? null;
}
