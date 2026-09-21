import type { PlanGroup } from '@expanses/core';
import { and, eq, gt, lte } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { entries, transactions } from '../schema';
import { assetValuesAt } from './asset-values';
import { setAsideViews } from './set-aside';

export interface IdleCashRow {
  accountId: string;
  name: string;
  currency: string;
  planGroup: PlanGroup;
  /** What the account holds on the date and is free: money set aside for a goal is not idle. */
  amountMinor: number;
  /** Date the newest money arrived, so the screen can say how long it has waited. */
  since: string;
}

/**
 * Money accounts that follow the ledger, with the date money last arrived in each. The Overview
 * uses it to notice cash parked at a broker: put there to be invested, still sitting as cash.
 */
export async function idleCash(database: Database, ws: WorkspaceContext, onDate: string): Promise<IdleCashRow[]> {
  // Only accounts valued at their ledger balance. A unit holding (market or snapshot) is worth its units at a price,
  // while what is free on it is its ledger balance less its promises: the two are not the same measure, so a holding
  // is never idle cash, promised or not. The spec (§4.6) names the free figure only; unit holdings stay out, as before.
  const values = (await assetValuesAt(database, ws, onDate)).filter((value) => value.mode === 'derived');
  if (values.length === 0) return [];

  const arrivals = await database.db
    .select({ accountId: entries.accountId, occurredOn: transactions.occurredOn })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        lte(transactions.occurredOn, onDate),
        gt(entries.amountMinor, 0),
      ),
    );
  const lastArrival = new Map<string, string>();
  for (const arrival of arrivals) {
    const known = lastArrival.get(arrival.accountId);
    if (known === undefined || arrival.occurredOn > known) lastArrival.set(arrival.accountId, arrival.occurredOn);
  }

  // Money promised to a goal is not waiting to be invested: only what is free counts as idle.
  const views = await setAsideViews(database, ws, { date: onDate });
  const rows: IdleCashRow[] = [];
  for (const value of values) {
    const since = lastArrival.get(value.accountId);
    if (since === undefined) continue;
    const view = views[value.accountId];
    // Like with like: a derived account's value is its ledger balance on the date, the balance its free figure is taken from.
    const amountMinor = view ? Math.max(0, view.freeMinor) : value.valueMinor;
    rows.push({ accountId: value.accountId, name: value.name, currency: value.currency, planGroup: value.planGroup, amountMinor, since });
  }
  return rows;
}
