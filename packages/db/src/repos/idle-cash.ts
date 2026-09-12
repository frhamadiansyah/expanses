import type { PlanGroup } from '@expanses/core';
import { and, eq, gt, lte } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { entries, transactions } from '../schema';
import { assetValuesAt } from './asset-values';

export interface IdleCashRow {
  accountId: string;
  name: string;
  currency: string;
  planGroup: PlanGroup;
  /** What the account holds on the date. */
  amountMinor: number;
  /** Date the newest money arrived, so the screen can say how long it has waited. */
  since: string;
}

/**
 * Money accounts that follow the ledger, with the date money last arrived in each. The Overview
 * uses it to notice cash parked at a broker: put there to be invested, still sitting as cash.
 */
export async function idleCash(database: Database, ws: WorkspaceContext, onDate: string): Promise<IdleCashRow[]> {
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

  const rows: IdleCashRow[] = [];
  for (const value of values) {
    const since = lastArrival.get(value.accountId);
    if (since === undefined) continue;
    rows.push({ accountId: value.accountId, name: value.name, currency: value.currency, planGroup: value.planGroup, amountMinor: value.valueMinor, since });
  }
  return rows;
}
