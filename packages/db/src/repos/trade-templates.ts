import { uuidv7 } from '@expanses/core';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { investmentTrades, tradeTemplates } from '../schema-assets';
import { AssetError, assertAccountInWorkspace } from './assets';

export interface TradeTemplateRow {
  id: string;
  workspaceId: string;
  accountId: string;
  cashAccountId: string;
  /** A fixed amount of money, or a fixed number of units. Exactly one of the two. */
  amountMinor: number | null;
  unitsMicro: number | null;
  dayOfMonth: number;
  active: boolean;
  /** Goal each buy from this template starts with; a recorded buy can override it. */
  goalId: string | null;
  /** 'buy' confirms units later; 'move' just parks money in a broker or savings account. */
  kind: 'buy' | 'move';
  createdAt: string;
}

export interface SaveTradeTemplateInput {
  id?: string;
  accountId: string;
  cashAccountId: string;
  amountMinor: number | null;
  unitsMicro: number | null;
  dayOfMonth: number;
  active: boolean;
  goalId?: string | null;
  kind?: 'buy' | 'move';
}

type TemplateDbRow = typeof tradeTemplates.$inferSelect;

const toRow = (row: TemplateDbRow): TradeTemplateRow => ({
  id: row.id,
  workspaceId: row.workspaceId,
  accountId: row.accountId,
  cashAccountId: row.cashAccountId,
  amountMinor: row.amountMinor,
  unitsMicro: row.unitsMicro,
  dayOfMonth: row.dayOfMonth,
  active: row.active === 1,
  goalId: row.goalId,
  kind: row.kind,
  createdAt: row.createdAt,
});

/** Adds or updates a monthly buy. */
export async function saveTradeTemplate(database: Database, ws: WorkspaceContext, input: SaveTradeTemplateInput): Promise<string> {
  if (input.kind === 'move' && (input.unitsMicro ?? null) !== null) throw new AssetError('A monthly move carries an amount, not units');
  const hasAmount = input.amountMinor !== null && input.amountMinor !== undefined;
  const hasUnits = input.unitsMicro !== null && input.unitsMicro !== undefined;
  if (hasAmount === hasUnits) throw new AssetError('A monthly buy needs an amount or a number of units, not both');
  if (hasAmount && !(input.amountMinor! > 0)) throw new AssetError('A monthly buy needs an amount greater than zero');
  if (hasUnits && !(input.unitsMicro! > 0)) throw new AssetError('A monthly buy needs units greater than zero');
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 28) {
    throw new AssetError('Pick a day between 1 and 28, so every month has it');
  }
  const id = input.id ?? uuidv7();
  const row = {
    id,
    workspaceId: ws.workspaceId,
    accountId: input.accountId,
    cashAccountId: input.cashAccountId,
    amountMinor: hasAmount ? input.amountMinor : null,
    unitsMicro: hasUnits ? input.unitsMicro : null,
    dayOfMonth: input.dayOfMonth,
    active: input.active ? 1 : 0,
    goalId: input.goalId ?? null,
    kind: input.kind ?? 'buy',
    createdAt: new Date().toISOString(),
  };
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, input.accountId, 'Asset');
    await assertAccountInWorkspace(tx, ws, input.cashAccountId, 'Cash account');
    const { createdAt, ...changes } = row;
    await tx.insert(tradeTemplates).values(row).onConflictDoUpdate({ target: tradeTemplates.id, set: changes });
  });
  return id;
}

export async function listTradeTemplates(database: Database, ws: WorkspaceContext): Promise<TradeTemplateRow[]> {
  const rows = await database.db
    .select()
    .from(tradeTemplates)
    .where(eq(tradeTemplates.workspaceId, ws.workspaceId))
    .orderBy(asc(tradeTemplates.createdAt));
  return rows.map(toRow);
}

/** Removes a monthly buy. Buys it already made stay, with the template's id on them. */
export async function deleteTradeTemplate(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.db.delete(tradeTemplates).where(and(eq(tradeTemplates.id, id), eq(tradeTemplates.workspaceId, ws.workspaceId)));
}

/**
 * Monthly buys whose day has passed this month with nothing recorded from them yet.
 * There is no background job: the Buy & sell page asks this when it opens.
 */
export async function dueTemplates(database: Database, ws: WorkspaceContext, onDate: string): Promise<TradeTemplateRow[]> {
  const month = onDate.slice(0, 7);
  const day = Number(onDate.slice(8, 10));
  const templates = (await listTradeTemplates(database, ws)).filter((template) => template.active && template.dayOfMonth <= day);
  if (templates.length === 0) return [];
  const recorded = await database.db
    .select({ templateId: investmentTrades.templateId })
    .from(investmentTrades)
    .where(
      and(
        eq(investmentTrades.workspaceId, ws.workspaceId),
        eq(investmentTrades.status, 'active'),
        gte(investmentTrades.occurredOn, `${month}-01`),
        lte(investmentTrades.occurredOn, `${month}-31`),
      ),
    );
  const done = new Set(recorded.map((row) => row.templateId).filter((id): id is string => id !== null));
  return templates.filter((template) => !done.has(template.id));
}
