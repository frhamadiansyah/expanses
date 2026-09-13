import { type BusinessReport, businessIncomeFor, type BusinessScheme, displayAmount, uuidv7, type TurnoverMonth } from '@expanses/core';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { incomeSources } from '../schema-business';
import { assertAccountInWorkspace } from './assets';

/** PP 55/2022 in rupiah: the slice an individual is not taxed on, and the ceiling the scheme ends at. */
export const UMKM_THRESHOLD_MINOR = 500_000_000;
export const UMKM_CEILING_MINOR = 4_800_000_000;

export class BusinessError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

export interface IncomeSourceRow {
  id: string;
  name: string;
  scheme: BusinessScheme;
  accountId: string;
  normaRateBps: number | null;
  kluCode: string | null;
  thresholdApplies: boolean;
}

export interface SaveIncomeSourceInput {
  id?: string;
  name: string;
  scheme: BusinessScheme;
  /** The wallet the business is run through. Its income postings are the turnover. */
  accountId: string;
  /** NPPN only, in basis points. The percentage depends on the trade, so only the owner knows it. */
  normaRateBps?: number | null;
  kluCode?: string | null;
  thresholdApplies?: boolean;
}

const toRow = (row: typeof incomeSources.$inferSelect): IncomeSourceRow => ({
  id: row.id,
  name: row.name,
  scheme: row.scheme,
  accountId: row.accountId,
  normaRateBps: row.normaRateBps,
  kluCode: row.kluCode,
  thresholdApplies: Boolean(row.thresholdApplies),
});

export async function listIncomeSources(database: Database, ws: WorkspaceContext): Promise<IncomeSourceRow[]> {
  const rows = await database.db
    .select()
    .from(incomeSources)
    .where(and(eq(incomeSources.workspaceId, ws.workspaceId), sql`${incomeSources.archivedAt} IS NULL`))
    .orderBy(incomeSources.createdAt);
  return rows.map(toRow);
}

/**
 * Adds or edits a business. A norma percentage belongs to NPPN alone: carrying one on a UMKM source
 * would suggest a net income nobody asked for, since UMKM is charged on turnover.
 */
export async function saveIncomeSource(database: Database, ws: WorkspaceContext, input: SaveIncomeSourceInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new BusinessError('NAME_REQUIRED', 'A business needs a name');
  await assertAccountInWorkspace(database.db, ws, input.accountId, 'Business wallet');

  const normaRateBps = input.scheme === 'nppn' ? (input.normaRateBps ?? null) : null;
  if (normaRateBps !== null && (!Number.isInteger(normaRateBps) || normaRateBps <= 0 || normaRateBps > 10_000)) {
    throw new BusinessError('NORMA_RANGE', 'The norma percentage must be above nought and no more than 100%');
  }

  const id = input.id ?? uuidv7();
  const row = {
    id,
    workspaceId: ws.workspaceId,
    name,
    scheme: input.scheme,
    accountId: input.accountId,
    normaRateBps,
    kluCode: input.kluCode?.trim() || null,
    thresholdApplies: input.thresholdApplies === false ? 0 : 1,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  };

  await database.db
    .insert(incomeSources)
    .values(row)
    .onConflictDoUpdate({
      target: incomeSources.id,
      set: {
        name: row.name,
        scheme: row.scheme,
        accountId: row.accountId,
        normaRateBps: row.normaRateBps,
        kluCode: row.kluCode,
        thresholdApplies: row.thresholdApplies,
      },
    });
  return id;
}

export async function archiveIncomeSource(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.db
    .update(incomeSources)
    .set({ archivedAt: new Date().toISOString() })
    .where(and(eq(incomeSources.workspaceId, ws.workspaceId), eq(incomeSources.id, id)));
}

/**
 * A month of turnover is the income side of the transactions that touched the business wallet.
 *
 * Reading the income postings rather than the money going in is what keeps the figure honest: your
 * own money moved across from the family wallet lands in the account too, and it is not a sale.
 */
async function turnoverByMonth(database: Database, ws: WorkspaceContext, accountId: string, taxYear: number): Promise<TurnoverMonth[]> {
  const rows = await database.db
    .select({
      month: sql<string>`substr(${transactions.occurredOn}, 6, 2)`,
      total: sql<number>`sum(${entries.amountBaseMinor})`,
    })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        eq(accounts.kind, 'income'),
        gte(transactions.occurredOn, `${taxYear}-01-01`),
        lte(transactions.occurredOn, `${taxYear}-12-31`),
        sql`${transactions.id} IN (SELECT transaction_id FROM entries WHERE account_id = ${accountId})`,
      ),
    )
    .groupBy(sql`substr(${transactions.occurredOn}, 6, 2)`);

  return rows.map((row) => ({ month: Number(row.month), amountMinor: displayAmount('income', Number(row.total)) }));
}

/** Both schemes for the year, with every figure derived from what you already recorded. */
export async function businessInputsFor(database: Database, ws: WorkspaceContext, taxYear: number): Promise<BusinessReport> {
  const sources = await listIncomeSources(database, ws);
  const turnover: Record<string, TurnoverMonth[]> = {};
  for (const source of sources) {
    turnover[source.id] = await turnoverByMonth(database, ws, source.accountId, taxYear);
  }
  return businessIncomeFor({
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      scheme: source.scheme,
      normaRateBps: source.normaRateBps,
      thresholdApplies: source.thresholdApplies,
    })),
    turnover,
    thresholdMinor: UMKM_THRESHOLD_MINOR,
    ceilingMinor: UMKM_CEILING_MINOR,
  });
}
