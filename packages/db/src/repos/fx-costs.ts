import {
  classifyInflow,
  currencyInfo,
  EXCHANGE_LOSS_KEY,
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
import { clampEventItemsTx } from './event-items';
import { type GainLossPair, inNoWorkspaceTx, pairByShape, writeGainLossTx } from './fx-gain-loss';
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
  /** The line's account kind ('expense', 'asset', …) and system key: what says a category line, or a pair's line. */
  accountKind: string;
  systemKey: string | null;
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

/** An account's lines, and the gain or loss pair of each transaction that has one (left out of `lines`). */
export interface AccountLines {
  lines: FxTxLine[];
  pairs: Map<string, GainLossPair>;
}

/**
 * Every line of every posted transaction that touches `accountId`, in the order they were written, each with its role,
 * and each exchange's gain or loss pair apart from them (it is the recalculation's own output, R8). Two reads, however
 * long the history (final review I2): the lines, and the pairs registered for them. A pair is known by the registry,
 * else by its shape (final review I3): a partner's edit reposts an exchange through apply, and its pair arrives as two
 * ordinary lines that only their shape still names.
 */
export async function accountLinesTx(db: Db, ws: WorkspaceContext, accountId: string, opts: { excludeTransactionId?: string | null } = {}): Promise<AccountLines> {
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
      ${opts.excludeTransactionId ? sql`AND t.id <> ${opts.excludeTransactionId}` : sql``}
    ORDER BY e.rowid`);
  const registered = new Map(
    (
      await db.values<[string, string, string]>(sql`
        SELECT transaction_id, category_entry_id, exchange_entry_id FROM fx_gain_loss
        WHERE transaction_id IN (SELECT transaction_id FROM entries WHERE account_id = ${accountId})`)
    ).map(([transactionId, category, exchange]) => [transactionId, { category, exchange }]),
  );
  const all = rows.map(([entryId, transactionId, lineAccount, currency, amountMinor, amountBaseMinor, fxRateToBase, kind, subtype, accountCurrency, systemKey, occurredOn, dayOrder, createdAt, isPlaceholder]): FxTxLine => ({
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
    accountKind: kind,
    systemKey,
    role: roleOf({ kind, subtype, currency: accountCurrency, systemKey, placeholder: Number(isPlaceholder) === 1 }, ws.baseCurrency),
  }));
  const byTransaction = new Map<string, FxTxLine[]>();
  for (const line of all) byTransaction.set(line.transactionId, [...(byTransaction.get(line.transactionId) ?? []), line]);
  const pairs = new Map<string, GainLossPair>();
  const left = new Set<string>();
  for (const [transactionId, txLines] of byTransaction) {
    const known = registered.get(transactionId);
    const ids = new Set(txLines.map((line) => line.entryId));
    const found = known && ids.has(known.category) && ids.has(known.exchange) ? { categoryEntryId: known.category, exchangeEntryId: known.exchange, registered: true } : null;
    const pair = found ?? (() => {
      const shaped = pairByShape(txLines, ws.baseCurrency);
      return shaped ? { ...shaped, registered: false } : null;
    })();
    if (!pair) continue;
    const category = txLines.find((line) => line.entryId === pair.categoryEntryId)!;
    pairs.set(transactionId, { ...pair, amountMinor: category.amountMinor, key: category.systemKey });
    left.add(pair.categoryEntryId).add(pair.exchangeEntryId);
  }
  return { lines: all.filter((line) => !left.has(line.entryId)), pairs };
}

/** `accountLinesTx`'s lines alone: what the screens' reads replay. */
export async function linesTouchingTx(db: Db, ws: WorkspaceContext, accountId: string, opts: { excludeTransactionId?: string | null } = {}): Promise<FxTxLine[]> {
  return (await accountLinesTx(db, ws, accountId, opts)).lines;
}

/** What each outflow line of the account was first posted at, positive (R4); absent for a line never rewritten. One read. */
async function dayValuesOfTx(db: Db, accountId: string): Promise<Map<string, number>> {
  const rows = await db.values<[string, number]>(sql`
    SELECT d.entry_id, d.base_minor FROM fx_day_values d JOIN entries e ON e.id = d.entry_id WHERE e.account_id = ${accountId}`);
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
  const dayValues = own.some((line) => line.amountMinor < 0) ? await dayValuesOfTx(db, accountId) : new Map<string, number>();
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

/** What the account's two caches hold now: each outflow's lots (as `usesKey`), and each shortfall. Two reads. */
async function cachesOfAccountTx(db: Db, accountId: string): Promise<{ uses: Map<string, string>; shortfalls: Map<string, number> }> {
  const rows = await db.values<[string, string, number, number]>(sql`SELECT out_entry_id, lot_entry_id, minor, cost_base_minor FROM fx_lot_uses WHERE account_id = ${accountId}`);
  const byOut = new Map<string, { lotId: string; minor: number; costBaseMinor: number }[]>();
  for (const [out, lotId, minor, cost] of rows) byOut.set(out, [...(byOut.get(out) ?? []), { lotId, minor: Number(minor), costBaseMinor: Number(cost) }]);
  const shortfalls = await db.values<[string, number]>(sql`SELECT entry_id, uncovered_minor FROM fx_shortfalls WHERE account_id = ${accountId}`);
  return { uses: new Map([...byOut].map(([out, uses]) => [out, usesKey(uses)])), shortfalls: new Map(shortfalls.map(([id, minor]) => [id, Number(minor)])) };
}

/** Rows per multi-row INSERT: 5 parameters a row stays far below SQLite's limit on bound parameters. */
const BATCH = 200;

async function inBatches<T>(items: readonly T[], write: (batch: readonly T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH) await write(items.slice(i, i + BATCH));
}

/**
 * Brings the account's two caches in line with this pass (final review I2): only the outflows whose lots or shortfall
 * changed are deleted and written again, in batches — a new spend at the end of a long history writes its own rows and
 * nothing else. `result` null: the account holds no lots (any more), and every row it had goes.
 */
async function writeCachesTx(db: Db, accountId: string, result: FifoResult | null, held: { uses: Map<string, string>; shortfalls: Map<string, number> } | null): Promise<void> {
  if (!result || !held) {
    await db.run(sql`DELETE FROM fx_lot_uses WHERE account_id = ${accountId}`);
    await db.run(sql`DELETE FROM fx_shortfalls WHERE account_id = ${accountId}`);
    if (!result) return;
  }
  const oldUses = held?.uses ?? new Map<string, string>();
  const oldShort = held?.shortfalls ?? new Map<string, number>();
  const newUses = new Map(result.outs.filter((out) => out.uses.length > 0).map((out) => [out.entryId, out]));
  const newShort = new Map(result.shortfalls.map((shortfall) => [shortfall.entryId, shortfall.uncoveredMinor]));

  const usesGone = [...oldUses.keys()].filter((out) => !newUses.has(out) || usesKey(newUses.get(out)!.uses) !== oldUses.get(out));
  const usesNew = [...newUses.values()].filter((out) => oldUses.get(out.entryId) !== usesKey(out.uses));
  const shortGone = [...oldShort.keys()].filter((id) => newShort.get(id) !== oldShort.get(id));
  const shortNew = [...newShort].filter(([id, minor]) => oldShort.get(id) !== minor);

  await inBatches(usesGone, (batch) => db.run(sql`DELETE FROM fx_lot_uses WHERE account_id = ${accountId} AND out_entry_id IN ${idList(batch)}`));
  const rows = usesNew.flatMap((out) => out.uses.map((use) => sql`(${accountId}, ${out.entryId}, ${use.lotId}, ${use.minor}, ${use.costBaseMinor})`));
  await inBatches(rows, (batch) => db.run(sql`INSERT INTO fx_lot_uses (account_id, out_entry_id, lot_entry_id, minor, cost_base_minor) VALUES ${sql.join([...batch], sql`, `)}`));
  await inBatches(shortGone, (batch) => db.run(sql`DELETE FROM fx_shortfalls WHERE account_id = ${accountId} AND entry_id IN ${idList(batch)}`));
  await inBatches(shortNew, (batch) =>
    db.run(sql`INSERT INTO fx_shortfalls (account_id, entry_id, uncovered_minor) VALUES ${sql.join(
      batch.map(([id, minor]) => sql`(${accountId}, ${id}, ${minor})`),
      sql`, `,
    )}`),
  );
}

/**
 * Whether a transaction is filed in a workspace by its own categories (a fee, a split, a spend), the pair the
 * recalculation added left out: a plain exchange is filed in Personal only while it carries its pair (R8), and must
 * still read as filed nowhere here, or the next pass would take the pair away and the one after put it back. A shared
 * event's derived transaction and a partner transfer's posting belong to no workspace, whatever else is on them.
 * `lines` are the transaction's lines without its pair; with no category line among them, nothing needs reading.
 */
async function filedInWorkspaceTx(db: Db, transactionId: string, lines: readonly FxTxLine[]): Promise<boolean> {
  if (!lines.some((line) => line.accountKind === 'income' || line.accountKind === 'expense')) return false;
  if (!(await hasBooks(db))) return false;
  if (await inNoWorkspaceTx(db, transactionId)) return false;
  const [row] = await db.values(sql`SELECT 1 FROM book_transactions WHERE transaction_id = ${transactionId} LIMIT 1`);
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

const expenseOf = (lines: readonly FxTxLine[], base: (line: FxTxLine) => number) =>
  lines.filter((line) => line.accountKind === 'expense').reduce((sum, line) => sum + base(line), 0);

/**
 * One account's pass: what it rewrote, and which pockets its moves carried lots into (the chain).
 *
 * Its cost stays proportional to what changed (final review I2): a fixed handful of reads for the whole account, then
 * writes only for the transactions whose figures move and the cache rows that differ. The replay itself still starts at
 * the first entry — the lots open at `fromDate` are the whole history — but FIFO is causal (R10): when every outflow
 * dated before `fromDate` used exactly the lots it used last time, nothing before `fromDate` can have moved and those
 * transactions are not revalued at all. Without `fromDate`, or with a cache that disagrees, every one is.
 */
export async function recalcAccountTx(
  tx: Db,
  ws: WorkspaceContext,
  accountId: string,
  fromDate: string | null = null,
): Promise<{ changedTransactions: string[]; chain: { accountId: string; fromDate: string }[] }> {
  if (!(await isLotAccountTx(tx, ws, accountId))) {
    await writeCachesTx(tx, accountId, null, null);
    return { changedTransactions: [], chain: [] };
  }
  const { lines, pairs } = await accountLinesTx(tx, ws, accountId);
  const { movements, inCosts, byTransaction } = await movementsOfTx(tx, ws, accountId, lines);
  const result = fifoCosts(movements);
  const transactionOf = new Map(lines.map((line) => [line.entryId, line.transactionId]));
  const outCosts = new Map<string, Record<string, number>>();
  for (const out of result.outs) {
    const transactionId = transactionOf.get(out.entryId)!;
    outCosts.set(transactionId, { ...(outCosts.get(transactionId) ?? {}), [out.entryId]: out.costBaseMinor });
  }
  const held = await cachesOfAccountTx(tx, accountId);
  const oldUses = held.uses;
  const newUses = new Map(result.outs.map((out) => [out.entryId, usesKey(out.uses)]));
  const dateOf = new Map(movements.map((movement) => [movement.entryId, movement.occurredOn]));
  const settled =
    fromDate !== null &&
    result.outs.every((out) => dateOf.get(out.entryId)! >= fromDate || ((oldUses.get(out.entryId) ?? '[]') === newUses.get(out.entryId) && (held.shortfalls.get(out.entryId) ?? 0) === out.uncoveredMinor));
  const changedTransactions: string[] = [];
  const chain: { accountId: string; fromDate: string }[] = [];

  for (const [transactionId, txLines] of byTransaction) {
    const out = outCosts.get(transactionId);
    const into = inCosts.get(transactionId);
    if (!out && !into) continue;
    if (settled && txLines[0]!.occurredOn < fromDate!) continue;
    const exchanged = txLines.some((line) => line.role === 'exchange');
    const pair = pairs.get(transactionId) ?? null;
    // Ruling: a pair is only ever written on a transaction in no workspace; one filed in a workspace spreads its whole
    // cost over its own lines (`asSpending`). Asked only where a pair could arise: money leaving across currencies.
    const filed = out !== undefined && exchanged && (await filedInWorkspaceTx(tx, transactionId, txLines));
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
      const lots = changed.filter((l) => l.role === 'lot');
      if (lots.length > 0) {
        await tx.run(sql`INSERT OR IGNORE INTO fx_day_values (entry_id, base_minor, rate) VALUES ${sql.join(
          lots.map((line) => sql`(${line.entryId}, ${line.amountBaseMinor}, ${line.fxRateToBase})`),
          sql`, `,
        )}`);
      }
      for (const line of changed) {
        const base = revalued.bases[line.entryId]!;
        await tx.run(sql`UPDATE entries SET amount_base_minor = ${base}, fx_rate_to_base = ${rateFor(line, base, ws.baseCurrency)} WHERE id = ${line.entryId}`);
      }
    }
    const gainLossBaseMinor = filed ? 0 : revalued.gainLossBaseMinor;
    // Only an exchange can carry a pair, or one that already has one (I2): a plain spend reads and writes nothing here.
    const pairWritten = exchanged || pair ? await writeGainLossTx(tx, ws, transactionId, gainLossBaseMinor, pair) : false;
    // Final review M1: a cheaper cost lowers what a purchase spent, and an event plan's covers of it are stored figures
    // that may now add to more than it. Cut as an edit of the purchase cuts them, so the next cover edit is not refused.
    // What it spent counts an Exchange loss too (it is an expense line, as the plan's total reads it).
    const spentBefore = expenseOf(txLines, (line) => line.amountBaseMinor) + (pair?.key === EXCHANGE_LOSS_KEY ? pair.amountMinor : 0);
    const spentAfter = expenseOf(txLines, (line) => revalued.bases[line.entryId]!) + Math.max(0, -gainLossBaseMinor);
    if (spentAfter < spentBefore) await clampEventItemsTx(tx, ws, transactionId);
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
  await writeCachesTx(tx, accountId, result, held);
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
    const pass = await recalcAccountTx(tx, ws, next, from);
    pass.changedTransactions.forEach((id) => changed.add(id));
    for (const link of pass.chain) queue.set(link.accountId, earlier(queue.has(link.accountId) ? queue.get(link.accountId)! : undefined, link.fromDate));
  }
  return { steps, changedTransactions: [...changed] };
}
