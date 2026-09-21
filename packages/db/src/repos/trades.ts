import {
  goalUnitsOf,
  outflowFrom,
  type Position,
  positionAfter,
  sellBasisMinor,
  type TradeAccounts,
  type TradeInput,
  type TradeKind,
  type TradeRecord,
  tradeDescription,
  tradePostings,
  uuidv7,
} from '@expanses/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries } from '../schema';
import { investmentTrades } from '../schema-assets';
import { goals } from '../schema-goals';
import { AssetError, assertAccountInWorkspace } from './assets';
import { adjustSetAsideTx, carryable, type SetAsideChoice, setAsideChoiceOfTx, setAsideTablesExist, stillPromisedTx, withSavedStage } from './set-aside-tx';
import { categoryIdsByKeyTx } from './categories';
import { systemAccountId } from './accounts';
import { postTransactionTx, voidTransactionTx } from './ledger';

export interface TradeRow extends TradeRecord {
  workspaceId: string;
  transactionId: string | null;
  cashAccountId: string | null;
  templateId: string | null;
  status: 'active' | 'replaced' | 'deleted';
  replacesTradeId: string | null;
}

export interface RecordTradeInput {
  accountId: string;
  kind: TradeKind;
  occurredOn: string;
  unitsMicro: number;
  grossMinor: number;
  feeMinor: number;
  taxMinor: number;
  /** Null pays from Opening Balances: a holding owned before the app. */
  cashAccountId: string | null;
  /** Goal this buy funds, or the goal a sell takes its units from. */
  goalId?: string | null;
  /** Category of the purchase when a credit card pays for it, so the points engine sees card spend. */
  spendCategoryId?: string | null;
  /** Merchant category code of that card purchase: gold and jewellery shops are 5944. */
  mcc?: string | null;
  /** Money that left the cash account, when it is in another currency. */
  cashMinor?: number;
  templateId?: string | null;
  ratesToBase?: Record<string, number>;
  /** Leaves the chart, the budgets and the category totals; balances, statements, points and net worth keep it. */
  excludedFromReport?: boolean;
  /** Photo rows written before the trade had a transaction — the contract note for this purchase. */
  photoIds?: string[];
  /** Which goal the money came out of, when it took more than was free (spec §4.4). */
  setAside?: SetAsideChoice | null;
}

export interface RecalculatedSell {
  tradeId: string;
  oldBasisMinor: number;
  newBasisMinor: number;
}

export interface TradeResult {
  tradeId: string;
  transactionId: string | null;
  /** Later sells whose cost basis moved because of this change. */
  recalculatedSells: RecalculatedSell[];
}

type TradeDbRow = typeof investmentTrades.$inferSelect;

const toRow = (row: TradeDbRow): TradeRow => ({
  id: row.id,
  workspaceId: row.workspaceId,
  accountId: row.accountId,
  transactionId: row.transactionId,
  kind: row.kind,
  occurredOn: row.occurredOn,
  createdAt: row.createdAt,
  unitsMicro: row.unitsMicro,
  grossMinor: row.grossMinor,
  feeMinor: row.feeMinor,
  taxMinor: row.taxMinor,
  cashAccountId: row.cashAccountId,
  goalId: row.goalId,
  reinvestedMinor: row.reinvestedMinor,
  reinvestedIntoAccountId: row.reinvestedIntoAccountId,
  templateId: row.templateId,
  status: row.status,
  replacesTradeId: row.replacesTradeId,
});

async function activeTrades(tx: Db, ws: WorkspaceContext, accountId?: string): Promise<TradeRow[]> {
  const where = [eq(investmentTrades.workspaceId, ws.workspaceId), eq(investmentTrades.status, 'active')];
  if (accountId) where.push(eq(investmentTrades.accountId, accountId));
  const rows = await tx
    .select()
    .from(investmentTrades)
    .where(and(...where))
    .orderBy(asc(investmentTrades.occurredOn), asc(investmentTrades.createdAt));
  return rows.map(toRow);
}

/** The accounts a trade posts to: the holding, the cash side, and the income and tax categories. */
async function tradeAccountsFor(tx: Db, ws: WorkspaceContext, accountId: string, cashAccountId: string | null): Promise<{ accounts: TradeAccounts; holdingName: string }> {
  const ids = cashAccountId ? [accountId, cashAccountId] : [accountId];
  const rows = await tx
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency, workspaceId: accounts.workspaceId })
    .from(accounts)
    .where(and(inArray(accounts.id, ids), eq(accounts.workspaceId, ws.workspaceId)));
  const holding = rows.find((row) => row.id === accountId);
  if (!holding) throw new AssetError('Asset not found in this workspace');
  const cash = cashAccountId ? rows.find((row) => row.id === cashAccountId) : undefined;
  if (cashAccountId && !cash) throw new AssetError('Cash account not found in this workspace');
  // Gains, investment income and the tax on them: the open workspace's copies, since the trade records there.
  const byKey = await categoryIdsByKeyTx(tx, ws);
  const need = (key: string) => {
    const id = byKey[key];
    if (!id) throw new AssetError(`The "${key}" category is missing. Reopen the app so default categories are restored.`);
    return id;
  };
  const holdingCurrency = holding.currency ?? ws.baseCurrency;
  return {
    holdingName: holding.name,
    accounts: {
      holdingAccountId: accountId,
      holdingCurrency,
      cashAccountId: cash?.id ?? (await systemAccountId(tx, ws, 'opening_balance')),
      cashCurrency: cash?.currency ?? holdingCurrency,
      realizedGainsCategoryId: need('income.realized_gains'),
      investmentIncomeCategoryId: need('income.investment'),
      finalTaxCategoryId: need('government_taxes.estimated_tax'),
      currencyExchangeAccountId: await systemAccountId(tx, ws, 'currency_exchange'),
    },
  };
}

const toInput = (input: RecordTradeInput): TradeInput => ({
  kind: input.kind,
  occurredOn: input.occurredOn,
  unitsMicro: input.unitsMicro,
  grossMinor: input.grossMinor,
  feeMinor: input.feeMinor,
  taxMinor: input.taxMinor,
  cashMinor: input.cashMinor,
});

const positionAt = (trades: TradeRecord[], onDate: string, exclude?: string): Position =>
  positionAfter(trades.filter((trade) => trade.id !== exclude), onDate);

/** What the ledger currently says a sell gave up, read back from its holding line. */
async function postedBasis(tx: Db, transactionId: string, holdingAccountId: string): Promise<number> {
  const rows = await tx
    .select({ amountMinor: entries.amountMinor })
    .from(entries)
    .where(and(eq(entries.transactionId, transactionId), eq(entries.accountId, holdingAccountId)));
  return -rows.reduce((total, row) => total + row.amountMinor, 0);
}

/**
 * Reposts sells on or after `fromDate` whose average cost moved. The ledger stays immutable:
 * each changed sell is voided and posted again in the same database transaction.
 */
async function recalculateSells(
  tx: Db,
  ws: WorkspaceContext,
  accountId: string,
  fromDate: string,
  ratesToBase: Record<string, number> | undefined,
): Promise<RecalculatedSell[]> {
  const trades = await activeTrades(tx, ws, accountId);
  const later = trades.filter((trade) => trade.kind === 'sell' && trade.occurredOn >= fromDate && trade.transactionId);
  if (later.length === 0) return [];
  const { accounts: tradeAccounts, holdingName } = await tradeAccountsFor(tx, ws, accountId, later[0]!.cashAccountId);
  const changed: RecalculatedSell[] = [];
  for (const sell of later) {
    const position = positionAt(trades, sell.occurredOn, sell.id);
    const newBasisMinor = sellBasisMinor(position, sell.unitsMicro);
    const oldBasisMinor = await postedBasis(tx, sell.transactionId!, accountId);
    if (oldBasisMinor === newBasisMinor) continue;
    const withCash = sell.cashAccountId === later[0]!.cashAccountId ? tradeAccounts : (await tradeAccountsFor(tx, ws, accountId, sell.cashAccountId)).accounts;
    const input = toInput({ ...sell, cashAccountId: sell.cashAccountId });
    const lines = tradePostings(input, position, withCash);
    await voidTransactionTx(tx, ws, sell.transactionId!);
    const replacement = await postTransactionTx(tx, ws, {
      occurredOn: sell.occurredOn,
      description: tradeDescription(input, holdingName),
      lines,
      ratesToBase,
      replacesTransactionId: sell.transactionId,
    });
    await tx.update(investmentTrades).set({ transactionId: replacement }).where(eq(investmentTrades.id, sell.id));
    changed.push({ tradeId: sell.id, oldBasisMinor, newBasisMinor });
  }
  return changed;
}

/** Writes a trade and its ledger transaction inside an open database transaction. */
/**
 * `saved` is an edit's original answer (replaceTrade): kept when `input.setAside` is undefined and it still pays from the
 * same account, as replaceTransaction carries one; and its stage kept when the same spend is given again.
 */
export async function writeTradeTx(
  tx: Db,
  ws: WorkspaceContext,
  input: RecordTradeInput,
  replacesTradeId: string | null,
  saved: SetAsideChoice | null = null,
): Promise<TradeResult> {
  await assertAccountInWorkspace(tx, ws, input.accountId, 'Asset');
  if (input.cashAccountId) await assertAccountInWorkspace(tx, ws, input.cashAccountId, 'Cash account');
  const { accounts: tradeAccounts, holdingName } = await tradeAccountsFor(tx, ws, input.accountId, input.cashAccountId);
  const trades = await activeTrades(tx, ws, input.accountId);
  const position = positionAt(trades, input.occurredOn);
  if (input.kind === 'sell') {
    await checkGoalUnits(tx, ws, trades, input);
    if (input.cashAccountId) {
      const [cash] = await tx
        .select({ subtype: accounts.subtype })
        .from(accounts)
        .where(and(eq(accounts.id, input.cashAccountId), eq(accounts.workspaceId, ws.workspaceId)));
      if (cash?.subtype === 'credit_card') throw new AssetError('Choose a bank or cash account for the proceeds');
    }
  }
  const tradeInput = toInput(input);
  const lines = tradePostings(tradeInput, position, tradeAccounts).map((line) =>
    // The card line carries the purchase category, so points are computed without it being spending.
    input.kind === 'buy' && input.spendCategoryId && input.cashAccountId && line.accountId === input.cashAccountId
      ? { ...line, spendCategoryId: input.spendCategoryId }
      : line,
  );
  const transactionId = lines.length
    ? await postTransactionTx(tx, ws, {
        occurredOn: input.occurredOn,
        description: tradeDescription(tradeInput, holdingName),
        lines,
        ratesToBase: input.ratesToBase,
        mcc: input.mcc ?? null,
        // A trade carries the two facts §4 scopes to "always", the same way every other way in does.
        excludedFromReport: input.excludedFromReport,
        photoIds: input.photoIds,
        setAside: withSavedStage(input.setAside !== undefined ? input.setAside : saved && carryable(saved, lines) ? saved : null, saved),
      })
    : null;
  const id = uuidv7();
  await tx.insert(investmentTrades).values({
    id,
    workspaceId: ws.workspaceId,
    accountId: input.accountId,
    transactionId,
    kind: input.kind,
    occurredOn: input.occurredOn,
    unitsMicro: input.unitsMicro,
    grossMinor: input.grossMinor,
    feeMinor: input.feeMinor,
    taxMinor: input.taxMinor,
    cashAccountId: input.cashAccountId,
    goalId: input.goalId ?? null,
    templateId: input.templateId ?? null,
    status: 'active',
    replacesTradeId,
    createdAt: new Date().toISOString(),
  });
  // Money parked for this goal in the account that paid is now units: lowered by what left that account, in its currency.
  if (input.kind === 'buy' && input.goalId && input.cashAccountId) {
    await adjustSetAsideTx(tx, ws, input.goalId, input.cashAccountId, -outflowFrom(lines, input.cashAccountId));
  }
  const recalculatedSells = await recalculateSells(tx, ws, input.accountId, input.occurredOn, input.ratesToBase);
  return { tradeId: id, transactionId, recalculatedSells };
}

/** A sell can only take units the named goal holds, so goals never borrow from each other. */
async function checkGoalUnits(tx: Db, ws: WorkspaceContext, trades: TradeRow[], input: RecordTradeInput): Promise<void> {
  const key = input.goalId ?? '';
  const held = goalUnitsOf(trades, input.occurredOn).byGoal[key] ?? 0;
  if (input.unitsMicro <= held) return;
  let whose = 'Units with no goal';
  if (key) {
    const [goal] = await tx.select({ name: goals.name }).from(goals).where(and(eq(goals.id, key), eq(goals.workspaceId, ws.workspaceId)));
    whose = goal ? goal.name : 'That goal';
  }
  throw new AssetError(`${whose} holds ${held / 1_000_000}; enter up to that`);
}

async function retire(tx: Db, ws: WorkspaceContext, tradeId: string, status: 'replaced' | 'deleted'): Promise<TradeRow> {
  const [row] = await tx
    .select()
    .from(investmentTrades)
    .where(and(eq(investmentTrades.id, tradeId), eq(investmentTrades.workspaceId, ws.workspaceId), eq(investmentTrades.status, 'active')));
  if (!row) throw new AssetError('That trade was already changed or removed');
  if (row.transactionId) await voidTransactionTx(tx, ws, row.transactionId);
  await tx.update(investmentTrades).set({ status }).where(eq(investmentTrades.id, tradeId));
  return toRow(row);
}

/** Records a buy, sell, income or unit change with its ledger transaction, in one database transaction. */
export function recordTrade(database: Database, ws: WorkspaceContext, input: RecordTradeInput): Promise<TradeResult> {
  return database.transaction((tx) => writeTradeTx(tx, ws, input, null));
}

/** Edits a trade: the old one and its transaction are retired and a fresh pair is written. */
export function replaceTrade(database: Database, ws: WorkspaceContext, tradeId: string, input: RecordTradeInput): Promise<TradeResult> {
  return database.transaction(async (tx) => {
    // The answer the old trade was saved with, read before the void reverses it, carried as an edit carries one.
    const [prior] = await tx
      .select({ transactionId: investmentTrades.transactionId })
      .from(investmentTrades)
      .where(and(eq(investmentTrades.id, tradeId), eq(investmentTrades.workspaceId, ws.workspaceId)));
    const saved = prior?.transactionId && (await setAsideTablesExist(tx)) ? await setAsideChoiceOfTx(tx, ws, prior.transactionId) : null;
    const old = await retire(tx, ws, tradeId, 'replaced');
    // A borrow from the goal the buy is now for is its own money, and a goal archived or no longer set aside there
    // is dropped rather than refused — the rules convertToPurchase and replaceTransaction follow.
    const kept = saved && saved.goalId !== (input.goalId ?? null) && (await stillPromisedTx(tx, ws, saved)) ? saved : null;
    const result = await writeTradeTx(tx, ws, input, tradeId, input.setAside === undefined ? kept : saved);
    const from = old.occurredOn < input.occurredOn ? old.occurredOn : input.occurredOn;
    const alreadyDone = new Set(result.recalculatedSells.map((sell) => sell.tradeId));
    const more = (await recalculateSells(tx, ws, input.accountId, from, input.ratesToBase)).filter((sell) => !alreadyDone.has(sell.tradeId));
    return { ...result, recalculatedSells: [...result.recalculatedSells, ...more] };
  });
}

export function deleteTrade(database: Database, ws: WorkspaceContext, tradeId: string): Promise<TradeResult> {
  return database.transaction(async (tx) => {
    const old = await retire(tx, ws, tradeId, 'deleted');
    const recalculatedSells = await recalculateSells(tx, ws, old.accountId, old.occurredOn, undefined);
    return { tradeId, transactionId: null, recalculatedSells };
  });
}

export async function listTrades(database: Database, ws: WorkspaceContext, opts: { accountId?: string } = {}): Promise<TradeRow[]> {
  return activeTrades(database.db, ws, opts.accountId);
}

/** Units and cost held per asset account, on a date or today. */
export async function positionsFor(database: Database, ws: WorkspaceContext, upTo?: string): Promise<Record<string, Position>> {
  const trades = await activeTrades(database.db, ws);
  const byAccount = new Map<string, TradeRow[]>();
  for (const trade of trades) {
    const list = byAccount.get(trade.accountId) ?? [];
    list.push(trade);
    byAccount.set(trade.accountId, list);
  }
  return Object.fromEntries([...byAccount].map(([accountId, list]) => [accountId, positionAfter(list, upTo)]));
}
