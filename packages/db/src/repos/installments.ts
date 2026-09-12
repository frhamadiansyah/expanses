import { type CardInstallment, type InstallmentSplit, installmentSplit, roundHalfAwayFromZero, uuidv7 } from '@expanses/core';
import { and, asc, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { cardInstallments } from '../schema-loans';

export class InstallmentDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallmentDbError';
  }
}

export interface CardInstallmentRow extends CardInstallment {
  id: string;
  cardAccountId: string;
  /** The purchase this plan was converted from, when it is known. */
  transactionId: string | null;
  description: string;
  createdAt: string;
}

export interface SaveInstallmentInput {
  cardAccountId: string;
  description: string;
  totalMinor: number;
  months: number;
  /** First month it appears on a statement, as YYYY-MM. */
  firstBilledMonth: string;
  transactionId?: string | null;
  rateBps?: number;
  conversionFeeMinor?: number;
  /** Many issuers pay no points on a converted purchase. */
  earnsPoints?: boolean;
}

async function cardAccountTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<void> {
  const [row] = await tx
    .select({ subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!row) throw new InstallmentDbError('Account not found in this workspace');
  if (row.subtype !== 'credit_card') throw new InstallmentDbError('Only a credit card carries instalment plans');
}

const toRow = (row: typeof cardInstallments.$inferSelect): CardInstallmentRow => ({
  id: row.id,
  cardAccountId: row.cardAccountId,
  transactionId: row.transactionId,
  description: row.description,
  totalMinor: row.totalMinor,
  months: row.months,
  monthlyMinor: row.monthlyMinor,
  firstBilledMonth: row.firstBilledMonth,
  rateBps: row.rateBps,
  conversionFeeMinor: row.conversionFeeMinor,
  earnsPoints: row.earnsPoints === 1,
  createdAt: row.createdAt,
});

/** Records a purchase the issuer turned into instalments. The purchase itself is left as it was. */
export async function saveInstallment(database: Database, ws: WorkspaceContext, input: SaveInstallmentInput): Promise<string> {
  if (!Number.isInteger(input.months) || input.months < 1) throw new InstallmentDbError('A plan runs for at least one month');
  if (!(input.totalMinor > 0)) throw new InstallmentDbError('A plan needs an amount greater than zero');

  const id = uuidv7();
  await database.transaction(async (tx) => {
    await cardAccountTx(tx, ws, input.cardAccountId);
    await tx.insert(cardInstallments).values({
      id,
      workspaceId: ws.workspaceId,
      cardAccountId: input.cardAccountId,
      transactionId: input.transactionId ?? null,
      description: input.description,
      totalMinor: input.totalMinor,
      months: input.months,
      // The last instalment carries the rounding, so the parts always add back to the total.
      monthlyMinor: roundHalfAwayFromZero(input.totalMinor / input.months),
      firstBilledMonth: input.firstBilledMonth,
      rateBps: input.rateBps ?? 0,
      conversionFeeMinor: input.conversionFeeMinor ?? 0,
      earnsPoints: (input.earnsPoints ?? true) ? 1 : 0,
      createdAt: new Date().toISOString(),
    });
  });
  return id;
}

export async function listInstallments(database: Database, ws: WorkspaceContext, cardAccountId?: string): Promise<CardInstallmentRow[]> {
  const where = cardAccountId
    ? and(eq(cardInstallments.workspaceId, ws.workspaceId), eq(cardInstallments.cardAccountId, cardAccountId))
    : eq(cardInstallments.workspaceId, ws.workspaceId);
  const rows = await database.db.select().from(cardInstallments).where(where).orderBy(asc(cardInstallments.createdAt));
  return rows.map(toRow);
}

/** Removes a plan. The purchase it came from stays exactly as it was. */
export async function deleteInstallment(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.db.delete(cardInstallments).where(and(eq(cardInstallments.id, id), eq(cardInstallments.workspaceId, ws.workspaceId)));
}

/** Billed, unbilled and what falls due beyond a year, added up per card on a date. */
export async function installmentTotals(database: Database, ws: WorkspaceContext, onDate: string): Promise<Record<string, InstallmentSplit>> {
  const rows = await listInstallments(database, ws);
  const totals: Record<string, InstallmentSplit> = {};
  for (const row of rows) {
    const split = installmentSplit(row, onDate);
    const running = totals[row.cardAccountId];
    totals[row.cardAccountId] = running
      ? {
          billedMinor: running.billedMinor + split.billedMinor,
          unbilledMinor: running.unbilledMinor + split.unbilledMinor,
          unbilledBeyond12Minor: running.unbilledBeyond12Minor + split.unbilledBeyond12Minor,
          monthsLeft: Math.max(running.monthsLeft, split.monthsLeft),
          lastMonth: running.lastMonth > split.lastMonth ? running.lastMonth : split.lastMonth,
        }
      : split;
  }
  return totals;
}

/** Purchases converted to a plan that earns nothing, so the points engine can refuse them. */
export async function nonEarningInstallmentTransactionIds(database: Database, ws: WorkspaceContext): Promise<Set<string>> {
  const rows = await database.db
    .select({ transactionId: cardInstallments.transactionId, earnsPoints: cardInstallments.earnsPoints })
    .from(cardInstallments)
    .where(eq(cardInstallments.workspaceId, ws.workspaceId));
  return new Set(rows.filter((row) => row.earnsPoints === 0 && row.transactionId !== null).map((row) => row.transactionId!));
}
