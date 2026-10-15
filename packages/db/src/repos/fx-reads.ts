import { convertMinor, currencyInfo, fifoCosts, type FxMovement, type FxOpenLot } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { isLotAccountTx, linesTouchingTx, movementsOfTx } from './fx-costs';
import { gainLossPairOfTx } from './fx-gain-loss';
import { fxTablesExist } from './fx-tables';

/*
 * What the screens read about the withdrawal rate (spec §7). The preview and the open lots replay the account in memory
 * through the same reader and `fifoCosts` the recalculation uses, so a figure on screen is the figure a save will
 * write; the receipt reads the cache the recalculation keeps (`fx_lot_uses`, `fx_shortfalls`).
 */

/** Base units per one unit of the foreign currency: what "(525)" says. */
export function ratePerUnit(costBaseMinor: number, minor: number, currency: string, baseCurrency: string): number {
  return costBaseMinor / 10 ** currencyInfo(baseCurrency).exponent / (minor / 10 ** currencyInfo(currency).exponent);
}

export interface ForeignCostPreview {
  currency: string;
  /** Null when part of it no withdrawal covers and no rate for the day is held (R20). */
  costBaseMinor: number | null;
  coveredMinor: number;
  coveredCostBaseMinor: number;
  uncoveredMinor: number;
  ratePerUnit: number | null;
  lots: { lotId: string; lotDate: string; minor: number }[];
}

/** Each lot's own date, by the id `fifoCosts` names it by. */
function lotDates(movements: readonly FxMovement[]): Map<string, string> {
  const dates = new Map<string, string>();
  for (const movement of movements) {
    if (movement.kind !== 'in') continue;
    if (movement.parts && movement.parts.length > 0) movement.parts.forEach((part) => dates.set(part.lotId, part.lotDate));
    else dates.set(movement.entryId, movement.occurredOn);
  }
  return dates;
}

/** What spending `amountMinor` from a foreign account on `occurredOn` would cost, before it is saved. */
export async function foreignCostPreview(
  database: Database,
  ws: WorkspaceContext,
  input: { accountId: string; amountMinor: number; occurredOn: string; excludeTransactionId?: string | null; dayRate?: number | null },
): Promise<ForeignCostPreview | null> {
  const db = database.db;
  if (!(await fxTablesExist(db)) || !(input.amountMinor > 0)) return null;
  const lot = await isLotAccountTx(db, ws, input.accountId);
  if (!lot) return null;
  const lines = await linesTouchingTx(db, ws, input.accountId, { excludeTransactionId: input.excludeTransactionId ?? null });
  const { movements } = await movementsOfTx(db, ws, input.accountId, lines);
  const rate = input.dayRate && input.dayRate > 0 ? input.dayRate : null;
  const dayValue = rate === null ? 0 : convertMinor(input.amountMinor, lot.currency, ws.baseCurrency, rate);
  // The newest row of its day: a new row lands on top of its day, which is last in time (R3).
  const previewed: FxMovement = { kind: 'out', entryId: '\u0000preview', occurredOn: input.occurredOn, dayOrder: null, createdAt: '9999-12-31T23:59:59.999Z', minor: input.amountMinor, dayValueBaseMinor: dayValue };
  const out = fifoCosts([...movements, previewed]).outs.find((o) => o.entryId === previewed.entryId)!;
  const coveredMinor = input.amountMinor - out.uncoveredMinor;
  const coveredCostBaseMinor = out.costBaseMinor - out.uncoveredBaseMinor;
  const costBaseMinor = out.uncoveredMinor > 0 && rate === null ? null : out.costBaseMinor;
  const dates = lotDates(movements);
  return {
    currency: lot.currency,
    costBaseMinor,
    coveredMinor,
    coveredCostBaseMinor,
    uncoveredMinor: out.uncoveredMinor,
    ratePerUnit: costBaseMinor === null ? null : ratePerUnit(costBaseMinor, input.amountMinor, lot.currency, ws.baseCurrency),
    lots: out.uses.map((use) => ({ lotId: use.lotId, lotDate: dates.get(use.lotId) ?? input.occurredOn, minor: use.minor })),
  };
}

export interface ForeignLotsView {
  accountId: string;
  currency: string;
  /** Oldest first. */
  open: FxOpenLot[];
  /** What the money still held cost: the account page's Cost. */
  costBaseMinor: number;
  /** What was spent with no withdrawal recorded. */
  shortfallMinor: number;
}

/** The withdrawals still held in a foreign account, each with what is left of it (§7, account page). */
export async function foreignLots(database: Database, ws: WorkspaceContext, accountId: string): Promise<ForeignLotsView | null> {
  const db = database.db;
  if (!(await fxTablesExist(db))) return null;
  const lot = await isLotAccountTx(db, ws, accountId);
  if (!lot) return null;
  const { movements } = await movementsOfTx(db, ws, accountId, await linesTouchingTx(db, ws, accountId));
  const result = fifoCosts(movements);
  return {
    accountId,
    currency: lot.currency,
    open: result.open,
    costBaseMinor: result.open.reduce((sum, open) => sum + open.leftCostBaseMinor, 0),
    shortfallMinor: result.shortfalls.reduce((sum, shortfall) => sum + shortfall.uncoveredMinor, 0),
  };
}

export interface WithdrawalUse {
  lotId: string;
  lotDate: string;
  minor: number;
  costBaseMinor: number;
}

export interface WithdrawalsUsed {
  accountId: string;
  currency: string;
  minor: number;
  costBaseMinor: number;
  uncoveredMinor: number;
  ratePerUnit: number | null;
  uses: WithdrawalUse[];
}

/** Which withdrawals a transaction's foreign money came from (§7, receipt): its largest foreign outflow's. */
export async function withdrawalsUsedBy(database: Database, ws: WorkspaceContext, transactionId: string): Promise<WithdrawalsUsed | null> {
  const db = database.db;
  if (!(await fxTablesExist(db))) return null;
  const rows = await db.values<[string, string, string, number, number]>(sql`
    SELECT e.id, e.account_id, e.currency, e.amount_minor, e.amount_base_minor FROM entries e
    WHERE e.transaction_id = ${transactionId} AND e.amount_minor < 0 ORDER BY e.amount_minor`);
  for (const [entryId, accountId, currency, amountMinor, amountBaseMinor] of rows) {
    if (!(await isLotAccountTx(db, ws, accountId))) continue;
    const uses = await db.values<[string, number, number, string]>(sql`
      SELECT u.lot_entry_id, u.minor, u.cost_base_minor, t.occurred_on
      FROM fx_lot_uses u JOIN entries e ON e.id = u.lot_entry_id JOIN transactions t ON t.id = e.transaction_id
      WHERE u.out_entry_id = ${entryId} ORDER BY t.occurred_on, u.lot_entry_id`);
    const [short] = await db.values<[number]>(sql`SELECT uncovered_minor FROM fx_shortfalls WHERE entry_id = ${entryId}`);
    const minor = -Number(amountMinor);
    const costBaseMinor = -Number(amountBaseMinor);
    return {
      accountId,
      currency,
      minor,
      costBaseMinor,
      uncoveredMinor: short ? Number(short[0]) : 0,
      ratePerUnit: ratePerUnit(costBaseMinor, minor, currency, ws.baseCurrency),
      uses: uses.map(([lotId, useMinor, cost, lotDate]) => ({ lotId, lotDate, minor: Number(useMinor), costBaseMinor: Number(cost) })),
    };
  }
  return null;
}

/** The gain (positive) or loss (negative) an exchange carries, or 0 (§5, R15). */
export async function exchangeResultOf(database: Database, transactionId: string): Promise<number> {
  if (!(await fxTablesExist(database.db))) return 0;
  const pair = await gainLossPairOfTx(database.db, transactionId);
  return pair ? -pair.amountMinor : 0;
}
