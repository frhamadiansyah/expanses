import { isFxLotAccount } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { beforeFlushTx, capturePausedTx, sessionValueTx } from '../sync/capture';
import { sharingTablesExist } from '../sync/placeholder';
import { recalcForeignTx } from './fx-costs';
import { fxTablesExist, queueForeignRecalcTx, WITHDRAWAL_RATE_NOTICE_KEY } from './fx-tables';

/*
 * When the withdrawal rate's recalculation runs (spec §6, ruling R9). Every ledger door marks the foreign accounts its
 * transaction touches; at the end of the db transaction each marked account is recalculated once, from the earliest
 * date marked, before capture resolves what changed — so a replace (a void and a post) is one recalculation, and its
 * new figures go out with the edit. Inside sync apply capture is paused: what apply touched waits in
 * `fx_recalc_pending`, and the engine drains it after the sync with capture on, so this phone's new figures reach the
 * partner as an ordinary edit. The first run after the update drains the same queue (R18).
 */

type Dirty = Map<string, { ws: WorkspaceContext; accountId: string; fromDate: string }>;
const DIRTY = 'fx.dirty';
const STEP = 'fx.recalc';

/** A door's one call: the foreign money accounts this transaction touches are recalculated at the end of the db transaction. */
export async function markForeignDirtyTx(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<void> {
  if (!(await fxTablesExist(tx))) return;
  const sharing = await sharingTablesExist(tx);
  const rows = await tx.values<[string, string, string, string | null, string]>(sql`
    SELECT DISTINCT e.account_id, a.kind, a.subtype, a.currency, t.occurred_on
    FROM entries e JOIN accounts a ON a.id = e.account_id JOIN transactions t ON t.id = e.transaction_id
    WHERE e.transaction_id = ${transactionId}
      ${sharing ? sql`AND e.account_id NOT IN (SELECT account_id FROM book_member_accounts)` : sql``}`);
  const lots = rows.filter(([, kind, subtype, currency]) => isFxLotAccount({ kind, subtype, currency }, ws.baseCurrency));
  if (lots.length === 0) return;
  const dirty = sessionValueTx<Dirty>(tx, DIRTY, () => new Map());
  if (!dirty) {
    // Not inside `Database.transaction` (nothing in the app writes that way): there is no end to wait for.
    for (const [accountId, , , , occurredOn] of lots) await recalcForeignTx(tx, ws, accountId, occurredOn);
    return;
  }
  for (const [accountId, , , , occurredOn] of lots) {
    const key = `${ws.workspaceId}\u0000${accountId}`;
    const held = dirty.get(key);
    if (!held || occurredOn < held.fromDate) dirty.set(key, { ws, accountId, fromDate: occurredOn });
  }
  beforeFlushTx(tx, STEP, () => runDirtyTx(tx));
}

async function runDirtyTx(tx: Db): Promise<void> {
  const dirty = sessionValueTx<Dirty>(tx, DIRTY, () => new Map());
  if (!dirty || dirty.size === 0) return;
  const work = [...dirty.values()];
  dirty.clear();
  const paused = capturePausedTx(tx);
  for (const { ws, accountId, fromDate } of work) {
    if (paused) await queueForeignRecalcTx(tx, accountId, fromDate);
    else await recalcForeignTx(tx, ws, accountId, fromDate);
  }
}

export interface ForeignDrain {
  /** Accounts taken off the queue this run. */
  done: number;
  /** Accounts still waiting. */
  left: number;
}

/** Where the drain counts each account's failed attempts (final review M6): a local setting, never synced. */
const FAILURES_KEY = 'fx.recalc_failures';

/** After this many failed attempts an account no longer holds the first-run notice back (it is still tried each run). */
export const NOTICE_AFTER_FAILURES = 3;

async function failuresOf(db: Db): Promise<Record<string, number>> {
  const [row] = await db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${FAILURES_KEY}`);
  if (!row) return {};
  try {
    const parsed: unknown = JSON.parse(row[0]);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

async function setFailuresTx(db: Db, failures: Record<string, number>): Promise<void> {
  if (Object.keys(failures).length === 0) await db.run(sql`DELETE FROM settings WHERE key = ${FAILURES_KEY}`);
  else await db.run(sql`INSERT INTO settings (key, value) VALUES (${FAILURES_KEY}, ${JSON.stringify(failures)}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
}

/**
 * Recalculates queued accounts, one per db transaction so the app's own reads and writes go between them (Review
 * Focus 5), up to `limit`. An account that fails stays queued for the next run and is skipped for the rest of this one;
 * one that no longer exists is simply taken off. Each failure is counted: an account that has failed
 * `NOTICE_AFTER_FAILURES` times is logged and no longer keeps the first-run notice waiting (M6). Nothing is wrong with
 * the money then — it keeps the figures it was posted at — and the notice would otherwise never show.
 */
export async function recalcPendingForeign(database: Database, opts: { limit?: number } = {}): Promise<ForeignDrain> {
  if (!(await fxTablesExist(database.db))) return { done: 0, left: 0 };
  const limit = opts.limit ?? Number.POSITIVE_INFINITY;
  const failed: string[] = [];
  const failures = await failuresOf(database.db);
  let done = 0;
  while (done < limit) {
    const [row] = await database.db.values<[string, string | null]>(
      sql`SELECT account_id, from_date FROM fx_recalc_pending ${failed.length > 0 ? sql`WHERE account_id NOT IN ${failed}` : sql``} ORDER BY rowid LIMIT 1`,
    );
    if (!row) break;
    const [accountId, fromDate] = row;
    try {
      await database.transaction(async (tx) => {
        await tx.run(sql`DELETE FROM fx_recalc_pending WHERE account_id = ${accountId}`);
        const [owner] = await tx.values<[string, string]>(sql`SELECT a.workspace_id, w.base_currency FROM accounts a JOIN workspaces w ON w.id = a.workspace_id WHERE a.id = ${accountId}`);
        if (owner) await recalcForeignTx(tx, { workspaceId: owner[0], baseCurrency: owner[1] }, accountId, fromDate);
      });
      done += 1;
      if (failures[accountId] !== undefined) {
        delete failures[accountId];
        await setFailuresTx(database.db, failures);
      }
    } catch (error) {
      failed.push(accountId);
      failures[accountId] = (failures[accountId] ?? 0) + 1;
      await setFailuresTx(database.db, failures);
      console.warn('A foreign account could not be recalculated yet; it waits for the next run', error);
      if (failures[accountId] === NOTICE_AFTER_FAILURES) {
        console.warn(`Foreign account ${accountId} failed to recalculate ${NOTICE_AFTER_FAILURES} times; it no longer holds back the withdrawal-rate notice`);
      }
    }
  }
  const [left] = await database.db.values<[number]>(sql`SELECT count(*) FROM fx_recalc_pending`);
  return { done, left: Number(left?.[0] ?? 0) };
}

/**
 * The first run's notice (R18): asked for by the migration, shown once nothing is left to recalculate — an account that
 * has failed `NOTICE_AFTER_FAILURES` times aside (M6).
 */
export async function withdrawalRateNoticeDue(database: Database): Promise<boolean> {
  if (!(await fxTablesExist(database.db))) return false;
  const [row] = await database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${WITHDRAWAL_RATE_NOTICE_KEY}`);
  if (row?.[0] !== 'due') return false;
  const failures = await failuresOf(database.db);
  const pending = await database.db.values<[string]>(sql`SELECT account_id FROM fx_recalc_pending`);
  return pending.every(([accountId]) => (failures[accountId] ?? 0) >= NOTICE_AFTER_FAILURES);
}

export async function dismissWithdrawalRateNotice(database: Database): Promise<void> {
  await database.db.run(sql`UPDATE settings SET value = 'shown' WHERE key = ${WITHDRAWAL_RATE_NOTICE_KEY}`);
}
