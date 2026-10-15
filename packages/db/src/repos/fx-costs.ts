import {
  classifyInflow,
  currencyInfo,
  fifoCosts,
  type FifoResult,
  FX_LOT_SUBTYPES,
  FxError,
  type FxLine,
  type FxLotPart,
  type FxMovement,
  type FxRole,
  isFxLotAccount,
  type Revalued,
  revalueTransaction,
  uuidv7,
} from '@expanses/core';
import { sql, type SQL } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { auditLog } from '../schema';
import { captureRevaluingTx } from '../sync/capture';
import { sharingTablesExist } from '../sync/placeholder';
import { hasBooks } from './books';
import { dayOrderExists } from './day-order-column';
import { inNoWorkspaceTx, writeGainLossTx } from './fx-gain-loss';
import { fxTablesExist, queueForeignRecalcTx } from './fx-tables';

/*
 * The withdrawal rate's recalculation (spec §6). One foreign account is replayed from its first entry (ruling R10): its
 * movements go through `fifoCosts`, each transaction it paid out of goes through `revalueTransaction`, and every base
 * figure that moved is rewritten in place — behind the capture door, so a shared purchase goes out with it — with the
 * gain or loss pair of an exchange and the account's two cache tables. A move into another foreign pocket queues that
 * pocket from the move's date: the chain.
 */

/** How many accounts one recalculation may chain through before the rest waits in the queue (R10). */
export const MAX_CHAIN = 64;

/** The kinds a line on another of the owner's accounts is "money" for (R6): a pocket, a bank, a card, a loan. */
const MONEY_SUBTYPES = new Set<string>([...FX_LOT_SUBTYPES, 'credit_card', 'loan']);

export interface FxTxLine extends FxLine {
  transactionId: string;
  accountId: string;
  occurredOn: string;
  dayOrder: number | null;
  createdAt: string;
  fxRateToBase: number;
}

function roleOf(account: { kind: string; subtype: string; currency: string | null; systemKey: string | null; placeholder: boolean }, baseCurrency: string): FxRole {
  if (account.systemKey === 'currency_exchange') return 'exchange';
  if (!account.placeholder && isFxLotAccount(account, baseCurrency)) return 'lot';
  if ((account.kind === 'asset' || account.kind === 'liability') && MONEY_SUBTYPES.has(account.subtype)) return 'money';
  return 'other';
}

const idList = (ids: readonly string[]) => sql`(${sql.join(
  ids.map((id) => sql`${id}`),
  sql`, `,
)})`;

const placeholderSql = async (db: Db, column: SQL) => ((await sharingTablesExist(db)) ? sql`(${column} IN (SELECT account_id FROM book_member_accounts))` : sql`0`);

/** The account, when it holds lots on this phone (R2): the owner's own foreign money, never a placeholder. */
export async function isLotAccountTx(db: Db, ws: WorkspaceContext, accountId: string): Promise<{ currency: string } | null> {
  const placeholder = await placeholderSql(db, sql`id`);
  const [row] = await db.values<[string, string, string | null, number]>(sql`SELECT kind, subtype, currency, ${placeholder} FROM accounts WHERE id = ${accountId} AND workspace_id = ${ws.workspaceId}`);
  if (!row || Number(row[3]) === 1 || !isFxLotAccount({ kind: row[0], subtype: row[1], currency: row[2] }, ws.baseCurrency)) return null;
  return { currency: row[2]! };
}

type LineRow = [string, string, string, string, number, number, number, string, string, string | null, string | null, string, number | null, string, number];

/**
 * Every line of every posted transaction that touches `accountId`, in the order they were written, each with its role;
 * an exchange's gain or loss pair is left out (it is the recalculation's own output, R8).
 */
export async function linesTouchingTx(db: Db, ws: WorkspaceContext, accountId: string, opts: { excludeTransactionId?: string | null } = {}): Promise<FxTxLine[]> {
  const placed = await dayOrderExists(db);
  const placeholder = await placeholderSql(db, sql`e.account_id`);
  const rows = await db.values<LineRow>(sql`
    SELECT e.id, e.transaction_id, e.account_id, e.currency, e.amount_minor, e.amount_base_minor, e.fx_rate_to_base,
           a.kind, a.subtype, a.currency, a.system_key, t.occurred_on, ${placed ? sql`t.day_order` : sql`NULL`}, t.created_at, ${placeholder}
    FROM entries e
    JOIN accounts a ON a.id = e.account_id
    JOIN transactions t ON t.id = e.transaction_id
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted'
      AND e.transaction_id IN (SELECT transaction_id FROM entries WHERE account_id = ${accountId})
      AND e.id NOT IN (SELECT category_entry_id FROM fx_gain_loss UNION ALL SELECT exchange_entry_id FROM fx_gain_loss)
      ${opts.excludeTransactionId ? sql`AND t.id <> ${opts.excludeTransactionId}` : sql``}
    ORDER BY e.rowid`);
  return rows.map(([entryId, transactionId, lineAccount, currency, amountMinor, amountBaseMinor, fxRateToBase, kind, subtype, accountCurrency, systemKey, occurredOn, dayOrder, createdAt, isPlaceholder]) => ({
    entryId,
    transactionId,
    accountId: lineAccount,
    currency,
    amountMinor: Number(amountMinor),
    amountBaseMinor: Number(amountBaseMinor),
    fxRateToBase: Number(fxRateToBase),
    occurredOn,
    dayOrder: dayOrder === null ? null : Number(dayOrder),
    createdAt,
    role: roleOf({ kind, subtype, currency: accountCurrency, systemKey, placeholder: Number(isPlaceholder) === 1 }, ws.baseCurrency),
  }));
}

/** What each outflow line was first posted at, positive (R4); absent for a line never rewritten. */
async function dayValuesOfTx(db: Db, entryIds: readonly string[]): Promise<Map<string, number>> {
  if (entryIds.length === 0) return new Map();
  const rows = await db.values<[string, number]>(sql`SELECT entry_id, base_minor FROM fx_day_values WHERE entry_id IN ${idList(entryIds)}`);
  return new Map(rows.map(([id, base]) => [id, -Number(base)]));
}

/** The lots each of these outflows used, with each lot's own date: what a move carries into the next pocket (§3). */
async function partsOfTx(db: Db, outEntryIds: readonly string[]): Promise<Map<string, FxLotPart[]>> {
  const parts = new Map<string, FxLotPart[]>();
  if (outEntryIds.length === 0) return parts;
  const rows = await db.values<[string, string, number, number, string]>(sql`
    SELECT u.out_entry_id, u.lot_entry_id, u.minor, u.cost_base_minor, t.occurred_on
    FROM fx_lot_uses u JOIN entries e ON e.id = u.lot_entry_id JOIN transactions t ON t.id = e.transaction_id
    WHERE u.out_entry_id IN ${idList(outEntryIds)} ORDER BY t.occurred_on, u.lot_entry_id`);
  for (const [out, lotId, minor, cost, lotDate] of rows) {
    const list = parts.get(out) ?? [];
    list.push({ lotId, lotDate, minor: Number(minor), costBaseMinor: Number(cost) });
    parts.set(out, list);
  }
  return parts;
}

/**
 * The account's movements as `fifoCosts` takes them (R4, R11): an outflow at the figure it was first posted at; an
 * inflow at its cost — written here for money changed from the base currency (`inCosts`), carried as the source pocket's
 * lots for a move, else as stored.
 */
export async function movementsOfTx(
  db: Db,
  ws: WorkspaceContext,
  accountId: string,
  lines: readonly FxTxLine[],
): Promise<{ movements: FxMovement[]; inCosts: Map<string, Record<string, number>>; byTransaction: Map<string, FxTxLine[]> }> {
  const byTransaction = new Map<string, FxTxLine[]>();
  for (const line of lines) byTransaction.set(line.transactionId, [...(byTransaction.get(line.transactionId) ?? []), line]);
  const own = lines.filter((line) => line.accountId === accountId && line.amountMinor !== 0);
  const dayValues = await dayValuesOfTx(db, own.filter((line) => line.amountMinor < 0).map((line) => line.entryId));
  const movements: FxMovement[] = [];
  const inCosts = new Map<string, Record<string, number>>();
  const carriedFrom = new Map<string, string>();
  for (const line of own) {
    const common = { entryId: line.entryId, occurredOn: line.occurredOn, dayOrder: line.dayOrder, createdAt: line.createdAt, minor: Math.abs(line.amountMinor) };
    if (line.amountMinor < 0) {
      movements.push({ ...common, kind: 'out', dayValueBaseMinor: dayValues.get(line.entryId) ?? -line.amountBaseMinor });
      continue;
    }
    const cost = classifyInflow(byTransaction.get(line.transactionId)!, line.entryId, ws.baseCurrency);
    if (cost.kind === 'exchanged') {
      inCosts.set(line.transactionId, { ...(inCosts.get(line.transactionId) ?? {}), [line.entryId]: cost.costs[line.entryId]! });
      movements.push({ ...common, kind: 'in', costBaseMinor: cost.costs[line.entryId]! });
      continue;
    }
    if (cost.kind === 'carried' && cost.fromEntryIds.length === 1) carriedFrom.set(line.entryId, cost.fromEntryIds[0]!);
    movements.push({ ...common, kind: 'in', costBaseMinor: line.amountBaseMinor });
  }
  // A move's lots, as the source pocket used them; whatever they do not cover (a shortfall there) arrives as a lot of
  // its own on the move's date. A stale or partial record is left as one lot: the source's next pass corrects it.
  const parts = await partsOfTx(db, [...carriedFrom.values()]);
  for (const movement of movements) {
    if (movement.kind !== 'in') continue;
    const used = parts.get(carriedFrom.get(movement.entryId) ?? '');
    if (!used) continue;
    const coveredMinor = used.reduce((sum, part) => sum + part.minor, 0);
    const coveredCost = used.reduce((sum, part) => sum + part.costBaseMinor, 0);
    const restMinor = movement.minor - coveredMinor;
    const restCost = movement.costBaseMinor - coveredCost;
    if (restMinor < 0 || (restMinor === 0 && restCost !== 0) || restCost < 0) continue;
    movement.parts = [...used, ...(restMinor > 0 ? [{ lotId: movement.entryId, lotDate: movement.occurredOn, minor: restMinor, costBaseMinor: restCost }] : [])];
  }
  return { movements, inCosts, byTransaction };
}

function rateFor(line: FxTxLine, base: number, baseCurrency: string): number {
  if (line.currency === baseCurrency) return 1;
  if (base === 0) return line.fxRateToBase;
  return Math.abs(base / line.amountMinor) * 10 ** (currencyInfo(line.currency).exponent - currencyInfo(baseCurrency).exponent);
}

const usesKey = (uses: readonly { lotId: string; minor: number; costBaseMinor: number }[]) =>
  JSON.stringify([...uses].sort((a, b) => (a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0)).map((use) => [use.lotId, use.minor, use.costBaseMinor]));

async function usesOfAccountTx(db: Db, accountId: string): Promise<Map<string, string>> {
  const rows = await db.values<[string, string, number, number]>(sql`SELECT out_entry_id, lot_entry_id, minor, cost_base_minor FROM fx_lot_uses WHERE account_id = ${accountId}`);
  const byOut = new Map<string, { lotId: string; minor: number; costBaseMinor: number }[]>();
  for (const [out, lotId, minor, cost] of rows) byOut.set(out, [...(byOut.get(out) ?? []), { lotId, minor: Number(minor), costBaseMinor: Number(cost) }]);
  return new Map([...byOut].map(([out, uses]) => [out, usesKey(uses)]));
}

async function writeCachesTx(db: Db, accountId: string, result: FifoResult | null): Promise<void> {
  await db.run(sql`DELETE FROM fx_lot_uses WHERE account_id = ${accountId}`);
  await db.run(sql`DELETE FROM fx_shortfalls WHERE account_id = ${accountId}`);
  if (!result) return;
  for (const out of result.outs) {
    for (const use of out.uses) {
      await db.run(sql`INSERT INTO fx_lot_uses (account_id, out_entry_id, lot_entry_id, minor, cost_base_minor) VALUES (${accountId}, ${out.entryId}, ${use.lotId}, ${use.minor}, ${use.costBaseMinor})`);
    }
  }
  for (const shortfall of result.shortfalls) {
    await db.run(sql`INSERT INTO fx_shortfalls (account_id, entry_id, uncovered_minor) VALUES (${accountId}, ${shortfall.entryId}, ${shortfall.uncoveredMinor})`);
  }
}

/**
 * Whether a transaction is filed in a workspace by its own categories (a fee, a split, a spend), the pair the
 * recalculation added left out: a plain exchange is filed in Personal only while it carries its pair (R8), and must
 * still read as filed nowhere here, or the next pass would take the pair away and the one after put it back. A shared
 * event's derived transaction and a partner transfer's posting belong to no workspace, whatever else is on them.
 */
async function filedInWorkspaceTx(db: Db, transactionId: string): Promise<boolean> {
  if (!(await hasBooks(db))) return false;
  if (await inNoWorkspaceTx(db, transactionId)) return false;
  const [row] = await db.values(sql`
    SELECT 1 FROM book_transactions b
    WHERE b.transaction_id = ${transactionId}
      AND EXISTS (
        SELECT 1 FROM entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.transaction_id = b.transaction_id AND a.kind IN ('income', 'expense')
          AND e.id NOT IN (SELECT category_entry_id FROM fx_gain_loss WHERE transaction_id = ${transactionId}))
    LIMIT 1`);
  return row !== undefined;
}

/**
 * A filed transaction's lines as `revalueTransaction` should read them: everything received — the owner's money on
 * the other side included — is a line the cost is spread over, so no gain or loss is left for a pair. The pair's
 * category is Personal's, and a Personal line inside a transaction filed in another workspace is the two-workspace
 * transaction the ledger refuses (TWO_BOOKS / OTHER_BOOK); inside Personal it would only say twice what the fee or
 * the spend already says. A base-currency line still keeps its figure (it is its amount), so a gap only base-currency
 * lines could close stays on the exchange account, as every exchange's gap did before the withdrawal rate.
 */
const asSpending = (lines: readonly FxTxLine[]): FxTxLine[] =>
  lines.map((line) => (line.role === 'money' || (line.role === 'lot' && line.amountMinor > 0) ? { ...line, role: 'other' } : line));

/** One account's pass: what it rewrote, and which pockets its moves carried lots into (the chain). */
export async function recalcAccountTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<{ changedTransactions: string[]; chain: { accountId: string; fromDate: string }[] }> {
  if (!(await isLotAccountTx(tx, ws, accountId))) {
    await writeCachesTx(tx, accountId, null);
    return { changedTransactions: [], chain: [] };
  }
  const lines = await linesTouchingTx(tx, ws, accountId);
  const { movements, inCosts, byTransaction } = await movementsOfTx(tx, ws, accountId, lines);
  const result = fifoCosts(movements);
  const transactionOf = new Map(lines.map((line) => [line.entryId, line.transactionId]));
  const outCosts = new Map<string, Record<string, number>>();
  for (const out of result.outs) {
    const transactionId = transactionOf.get(out.entryId)!;
    outCosts.set(transactionId, { ...(outCosts.get(transactionId) ?? {}), [out.entryId]: out.costBaseMinor });
  }
  const oldUses = await usesOfAccountTx(tx, accountId);
  const newUses = new Map(result.outs.map((out) => [out.entryId, usesKey(out.uses)]));
  const changedTransactions: string[] = [];
  const chain: { accountId: string; fromDate: string }[] = [];

  for (const [transactionId, txLines] of byTransaction) {
    const out = outCosts.get(transactionId);
    const into = inCosts.get(transactionId);
    if (!out && !into) continue;
    // Ruling: a pair is only ever written on a transaction in no workspace; one filed in a workspace spreads its whole
    // cost over its own lines (`asSpending`). Asked only where a pair could arise: money leaving across currencies.
    const filed = out !== undefined && txLines.some((line) => line.role === 'exchange') && (await filedInWorkspaceTx(tx, transactionId));
    let revalued: Revalued;
    try {
      revalued = revalueTransaction({ lines: filed ? asSpending(txLines) : txLines, baseCurrency: ws.baseCurrency, ...(out ? { outCosts: out } : {}), ...(into ? { inCosts: into } : {}) });
    } catch (error) {
      // A transaction no screen could have made (a pocket paying out with nothing on the other side) keeps the figures
      // it was posted at; one bad row must never stop every other write to this account.
      if (error instanceof FxError) {
        console.warn(`Withdrawal rate: left ${transactionId} at its posted figures`, error.message);
        continue;
      }
      throw error;
    }
    const changed = txLines.filter((line) => revalued.bases[line.entryId] !== line.amountBaseMinor);
    if (changed.length > 0) {
      await captureRevaluingTx(tx, transactionId);
      for (const line of changed.filter((l) => l.role === 'lot')) {
        await tx.run(sql`INSERT OR IGNORE INTO fx_day_values (entry_id, base_minor, rate) VALUES (${line.entryId}, ${line.amountBaseMinor}, ${line.fxRateToBase})`);
      }
      for (const line of changed) {
        const base = revalued.bases[line.entryId]!;
        await tx.run(sql`UPDATE entries SET amount_base_minor = ${base}, fx_rate_to_base = ${rateFor(line, base, ws.baseCurrency)} WHERE id = ${line.entryId}`);
      }
    }
    const gainLossBaseMinor = filed ? 0 : revalued.gainLossBaseMinor;
    const pairWritten = await writeGainLossTx(tx, ws, transactionId, gainLossBaseMinor);
    if (changed.length > 0 || pairWritten) {
      changedTransactions.push(transactionId);
      await tx.insert(auditLog).values({
        id: uuidv7(),
        workspaceId: ws.workspaceId,
        action: 'revalue',
        entity: 'transaction',
        entityId: transactionId,
        payloadJson: JSON.stringify({ accountId, bases: Object.fromEntries(changed.map((line) => [line.entryId, revalued.bases[line.entryId]])), gainLossBaseMinor }),
        createdAt: new Date().toISOString(),
      });
    }
    // The chain (§6, R10): money arriving in another pocket whose figure changed here, or — a same-currency move —
    // whose carried lots changed though the figure did not. A filed exchange into another currency's pocket changes
    // that pocket's figure too (`asSpending`), and its own recalculation must then read the new cost: chained as well.
    for (const line of txLines) {
      if (line.role !== 'lot' || line.accountId === accountId || line.amountMinor <= 0) continue;
      const source = txLines.find((l) => l.accountId === accountId && l.amountMinor < 0 && l.currency === line.currency);
      const lotsMoved = source !== undefined && (oldUses.get(source.entryId) ?? '[]') !== (newUses.get(source.entryId) ?? '[]');
      if (revalued.bases[line.entryId] !== line.amountBaseMinor || lotsMoved) chain.push({ accountId: line.accountId, fromDate: line.occurredOn });
    }
  }
  await writeCachesTx(tx, accountId, result);
  return { changedTransactions, chain };
}

const earlier = (held: string | null | undefined, next: string | null): string | null => (held === undefined ? next : held === null || next === null ? null : held < next ? held : next);

/**
 * Recalculates `accountId` and every pocket its moves carry lots into, each once per change, until a pass changes
 * nothing (§6). `fromDate` is where the change that asked for it begins: FIFO is causal, so nothing dated before it
 * moves (R10); the account is still replayed whole, because its lots at `fromDate` are its whole history. Past
 * `maxSteps` passes the rest is queued in `fx_recalc_pending` rather than looping. Nothing on a database before 0071.
 */
export async function recalcForeignTx(
  tx: Db,
  ws: WorkspaceContext,
  accountId: string,
  fromDate: string | null,
  opts: { maxSteps?: number } = {},
): Promise<{ steps: number; changedTransactions: string[] }> {
  if (!(await fxTablesExist(tx))) return { steps: 0, changedTransactions: [] };
  const maxSteps = opts.maxSteps ?? MAX_CHAIN;
  const queue = new Map<string, string | null>([[accountId, fromDate]]);
  const changed = new Set<string>();
  let steps = 0;
  while (queue.size > 0) {
    const [next, from] = queue.entries().next().value as [string, string | null];
    queue.delete(next);
    if (steps >= maxSteps) {
      await queueForeignRecalcTx(tx, next, from);
      continue;
    }
    steps += 1;
    const pass = await recalcAccountTx(tx, ws, next);
    pass.changedTransactions.forEach((id) => changed.add(id));
    for (const link of pass.chain) queue.set(link.accountId, earlier(queue.has(link.accountId) ? queue.get(link.accountId)! : undefined, link.fromDate));
  }
  return { steps, changedTransactions: [...changed] };
}
