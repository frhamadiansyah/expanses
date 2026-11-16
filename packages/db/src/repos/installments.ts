import { type CardInstallment, INSTALMENT_COUNT_MODES, type InstalmentCountMode, type InstallmentSplit, installmentSplit, roundHalfAwayFromZero, uuidv7 } from '@expanses/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { cardInstallments } from '../schema-loans';
import { captureSpreadingTx } from '../sync/capture';

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
  /**
   * How its spending counts (0120): each instalment as that month's spending on its statement date, the purchase then
   * counting nothing, or the purchase in full on its day. Before 0120 every plan counted at purchase.
   */
  countMode: InstalmentCountMode;
}

/*
 * count_mode (0120) is read and written by name, never through the drizzle table: a database stopped before 0120 has no
 * such column, and every select the schema writes would name it. There every plan counts at purchase, as it did.
 */
const countModeColumn = new WeakMap<Db, boolean>();

export async function countModeColumnExists(db: Db): Promise<boolean> {
  if (countModeColumn.get(db)) return true;
  const rows = await db.values(sql`SELECT 1 FROM pragma_table_info('card_installments') WHERE name = 'count_mode'`);
  if (rows.length > 0) countModeColumn.set(db, true);
  return rows.length > 0;
}

const isCountMode = (value: unknown): value is InstalmentCountMode => INSTALMENT_COUNT_MODES.includes(value as InstalmentCountMode);

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
  /** Each month unless said: the owner's choice for new plans. */
  countMode?: InstalmentCountMode;
}

async function cardAccountTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<void> {
  const [row] = await tx
    .select({ subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!row) throw new InstallmentDbError('Account not found in this workspace');
  if (row.subtype !== 'credit_card') throw new InstallmentDbError('Only a credit card carries instalment plans');
}

const toRow = (row: typeof cardInstallments.$inferSelect, countMode: InstalmentCountMode = 'at_purchase'): CardInstallmentRow => ({
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
  countMode,
});

/**
 * The purchase a plan is tied to must be a posted transaction on the same card, and no other plan's: two plans spreading
 * one purchase would count it twice.
 */
async function purchaseForPlanTx(tx: Db, ws: WorkspaceContext, cardAccountId: string, transactionId: string, planId: string | null): Promise<void> {
  const [onCard] = await tx.values<[number]>(sql`
    SELECT 1 FROM transactions t JOIN entries e ON e.transaction_id = t.id
    WHERE t.id = ${transactionId} AND t.workspace_id = ${ws.workspaceId} AND t.status = 'posted' AND e.account_id = ${cardAccountId} AND e.amount_minor < 0
    LIMIT 1`);
  if (!onCard) throw new InstallmentDbError('The purchase must be one made on this card');
  const [taken] = await tx.values<[string]>(sql`
    SELECT id FROM card_installments WHERE workspace_id = ${ws.workspaceId} AND transaction_id = ${transactionId} AND id != ${planId ?? ''} LIMIT 1`);
  if (taken) throw new InstallmentDbError('That purchase is already another plan');
}

async function writeCountModeTx(tx: Db, ws: WorkspaceContext, id: string, countMode: InstalmentCountMode): Promise<void> {
  if (!isCountMode(countMode)) throw new InstallmentDbError('Count spending is At purchase or Each month');
  if (!(await countModeColumnExists(tx))) return;
  await tx.run(sql`UPDATE card_installments SET count_mode = ${countMode} WHERE id = ${id} AND workspace_id = ${ws.workspaceId}`);
}

/** Records a purchase the issuer turned into instalments. The purchase itself is left as it was. */
export async function saveInstallment(database: Database, ws: WorkspaceContext, input: SaveInstallmentInput): Promise<string> {
  if (!Number.isInteger(input.months) || input.months < 1) throw new InstallmentDbError('A plan runs for at least one month');
  if (!(input.totalMinor > 0)) throw new InstallmentDbError('A plan needs an amount greater than zero');

  const id = uuidv7();
  await database.transaction(async (tx) => {
    await cardAccountTx(tx, ws, input.cardAccountId);
    if (input.transactionId) await purchaseForPlanTx(tx, ws, input.cardAccountId, input.transactionId, null);
    // A shared purchase goes out again with its spread (card instalments C, sync).
    if (input.transactionId) await captureSpreadingTx(tx, input.transactionId);
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
    await writeCountModeTx(tx, ws, id, input.countMode ?? 'each_month');
  });
  return id;
}

export interface UpdateInstallmentInput {
  id: string;
  description: string;
  totalMinor: number;
  months: number;
  /** First month it appears on a statement, as YYYY-MM. */
  firstBilledMonth: string;
  earnsPoints: boolean;
  /** Left out, the plan keeps the purchase it has; null unties it. */
  transactionId?: string | null;
  /** Left out, the plan keeps counting as it does. */
  countMode?: InstalmentCountMode;
}

/**
 * Changes what a plan says about itself. Only the plan row moves: the purchase it came from and the card's balance
 * stay as they were, and the billed, held and ending figures follow from the total, months and first month.
 */
export async function updateInstallment(database: Database, ws: WorkspaceContext, input: UpdateInstallmentInput): Promise<void> {
  if (!Number.isInteger(input.months) || input.months < 1) throw new InstallmentDbError('A plan runs for at least one month');
  if (!Number.isInteger(input.totalMinor) || !(input.totalMinor > 0)) throw new InstallmentDbError('A plan needs a whole amount greater than zero');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.firstBilledMonth)) throw new InstallmentDbError('The first billed month is a year and month');

  await database.transaction(async (tx) => {
    const found = await tx
      .select({ id: cardInstallments.id, cardAccountId: cardInstallments.cardAccountId, transactionId: cardInstallments.transactionId })
      .from(cardInstallments)
      .where(and(eq(cardInstallments.id, input.id), eq(cardInstallments.workspaceId, ws.workspaceId)));
    if (found.length === 0) throw new InstallmentDbError('Plan not found in this workspace');
    if (input.transactionId) await purchaseForPlanTx(tx, ws, found[0]!.cardAccountId, input.transactionId, input.id);
    // The purchase it spread and the one it spreads now, when shared, go out again with their spreads.
    for (const id of new Set([found[0]!.transactionId, input.transactionId === undefined ? found[0]!.transactionId : input.transactionId])) if (id) await captureSpreadingTx(tx, id);
    await tx
      .update(cardInstallments)
      .set({
        description: input.description,
        totalMinor: input.totalMinor,
        months: input.months,
        // The last instalment carries the rounding, as when the plan was saved.
        monthlyMinor: roundHalfAwayFromZero(input.totalMinor / input.months),
        firstBilledMonth: input.firstBilledMonth,
        earnsPoints: input.earnsPoints ? 1 : 0,
        ...(input.transactionId !== undefined ? { transactionId: input.transactionId } : {}),
      })
      .where(and(eq(cardInstallments.id, input.id), eq(cardInstallments.workspaceId, ws.workspaceId)));
    if (input.countMode !== undefined) await writeCountModeTx(tx, ws, input.id, input.countMode);
  });
}

/**
 * Sets how a plan's spending counts: At purchase or Each month. Only the reading changes — the purchase, the card's
 * balance and its statements stay exactly as they were.
 */
export async function setInstallmentCountMode(database: Database, ws: WorkspaceContext, id: string, countMode: InstalmentCountMode): Promise<void> {
  await database.transaction(async (tx) => {
    const [found] = await tx
      .select({ id: cardInstallments.id, transactionId: cardInstallments.transactionId })
      .from(cardInstallments)
      .where(and(eq(cardInstallments.id, id), eq(cardInstallments.workspaceId, ws.workspaceId)));
    if (!found) throw new InstallmentDbError('Plan not found in this workspace');
    if (found.transactionId) await captureSpreadingTx(tx, found.transactionId);
    await writeCountModeTx(tx, ws, id, countMode);
  });
}

export async function listInstallments(database: Database, ws: WorkspaceContext, cardAccountId?: string): Promise<CardInstallmentRow[]> {
  return listInstallmentsTx(database.db, ws, cardAccountId);
}

/** `listInstallments` inside an open transaction. */
export async function listInstallmentsTx(db: Db, ws: WorkspaceContext, cardAccountId?: string): Promise<CardInstallmentRow[]> {
  const where = cardAccountId
    ? and(eq(cardInstallments.workspaceId, ws.workspaceId), eq(cardInstallments.cardAccountId, cardAccountId))
    : eq(cardInstallments.workspaceId, ws.workspaceId);
  const rows = await db.select().from(cardInstallments).where(where).orderBy(asc(cardInstallments.createdAt));
  if (rows.length === 0 || !(await countModeColumnExists(db))) return rows.map((row) => toRow(row));
  const modes = new Map(
    (await db.values<[string, string]>(sql`SELECT id, count_mode FROM card_installments WHERE workspace_id = ${ws.workspaceId}`)).map(([id, mode]) => [id, mode]),
  );
  return rows.map((row) => {
    const mode = modes.get(row.id);
    return toRow(row, isCountMode(mode) ? mode : 'at_purchase');
  });
}

/** Removes a plan. The purchase it came from stays exactly as it was. */
export async function deleteInstallment(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [found] = await tx.select({ transactionId: cardInstallments.transactionId }).from(cardInstallments).where(and(eq(cardInstallments.id, id), eq(cardInstallments.workspaceId, ws.workspaceId)));
    // A shared purchase it spread goes out again, counting at purchase.
    if (found?.transactionId) await captureSpreadingTx(tx, found.transactionId);
    await tx.delete(cardInstallments).where(and(eq(cardInstallments.id, id), eq(cardInstallments.workspaceId, ws.workspaceId)));
  });
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
