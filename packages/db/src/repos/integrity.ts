import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { checkLedgerIntegrity } from './ledger';
import { contextOf, listWorkspaces } from './workspaces';

export interface IntegrityProblem {
  kind: 'quick_check' | 'integrity_check' | 'unbalanced' | 'orphan-entries' | 'orphan-transactions' | 'ledger-unreadable';
  /** One line, safe to show under "Details". Never a stack trace. */
  detail: string;
}

export interface LedgerHealth {
  /** Posted transactions whose entries do not sum to zero, per currency. */
  unbalanced: Awaited<ReturnType<typeof checkLedgerIntegrity>>;
  /** Entry ids pointing at a transaction or an account that is not there. */
  orphanEntries: string[];
  /** Posted transaction ids with no entries at all. */
  orphanTransactions: string[];
}

// Drizzle wraps the driver's error as "Failed query: …"; the sentence a user should see — "database disk
// image is malformed" and the like — is underneath, on .cause.
const message = (error: unknown): string => {
  if (error instanceof Error) return error.cause instanceof Error ? message(error.cause) : error.message;
  return String(error);
};

/**
 * SQLite's own opinion of the file. A corrupt database answers in two ways — it throws
 * ("database disk image is malformed") or it returns rows that are not "ok" — and both count.
 * quick_check walks every page but skips the index-versus-table cross-check, so it is the one run at
 * every open; integrity_check is asked for after a migration that touched an index.
 */
export async function checkStructure(database: Database, pragma: 'quick_check' | 'integrity_check' = 'quick_check'): Promise<IntegrityProblem[]> {
  let rows: unknown[][];
  try {
    rows = await database.db.values<unknown[]>(sql.raw(`PRAGMA ${pragma}(1)`));
  } catch (error) {
    return [{ kind: pragma, detail: message(error) }];
  }
  const answers = rows.map((row) => String(row[0]));
  if (answers.length === 1 && answers[0] === 'ok') return [];
  return [{ kind: pragma, detail: answers.join('; ') || 'no answer' }];
}

/**
 * How many bytes the database says it is, from its own header: `page_count * page_size`.
 *
 * Two pragmas, no export, no page walk — which is the whole point. It is asked *before* `quick_check` so
 * the caller can decide whether that check is still affordable on the path to first paint (spec §11.4's
 * size guard). `null` is the answer from a file that will not say, and a caller should read that as
 * "ask anyway": a database too broken to report its own size is exactly one worth checking.
 */
export async function databaseBytes(database: Database): Promise<number | null> {
  try {
    const [countRow] = await database.db.values<[number]>(sql.raw('PRAGMA page_count'));
    const [sizeRow] = await database.db.values<[number]>(sql.raw('PRAGMA page_size'));
    const pages = Number(countRow?.[0] ?? 0);
    const pageSize = Number(sizeRow?.[0] ?? 0);
    if (!pages || !pageSize || !Number.isFinite(pages) || !Number.isFinite(pageSize)) return null;
    return pages * pageSize;
  } catch {
    return null;
  }
}

/** What the ledger says about itself: every posted transaction balances, and nothing dangles. */
export async function checkLedgerHealth(database: Database, ws: WorkspaceContext): Promise<LedgerHealth> {
  const unbalanced = await checkLedgerIntegrity(database, ws);
  const orphanEntries = await database.db.values<[string]>(sql`
    SELECT e.id FROM entries e
    WHERE e.workspace_id = ${ws.workspaceId}
      AND (NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = e.transaction_id)
        OR NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = e.account_id))
    ORDER BY e.id`);
  const orphanTransactions = await database.db.values<[string]>(sql`
    SELECT t.id FROM transactions t
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted'
      AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = t.id)
    ORDER BY t.id`);
  return {
    unbalanced,
    orphanEntries: orphanEntries.map((r) => String(r[0])),
    orphanTransactions: orphanTransactions.map((r) => String(r[0])),
  };
}

/**
 * Everything, in the order that costs least: the file first, then each workspace's ledger.
 *
 * Like `checkStructure`, this answers rather than throws. A ledger table that an update dropped, renamed
 * or reshaped makes these queries fail, and that *is* the finding — the one this check exists to catch. A
 * caller that undoes a bad update on a failed check has to be given the failure as a problem, or the throw
 * would sail past its rollback and leave the half-updated file in place.
 */
export async function checkDatabase(database: Database, options: { deep?: boolean } = {}): Promise<IntegrityProblem[]> {
  const structure = await checkStructure(database, options.deep ? 'integrity_check' : 'quick_check');
  // A malformed file cannot be asked anything else; asking would only throw.
  if (structure.length) return structure;

  const problems: IntegrityProblem[] = [];
  let workspaces: Awaited<ReturnType<typeof listWorkspaces>>;
  try {
    workspaces = await listWorkspaces(database);
  } catch (error) {
    // Without the workspace list there is no ledger to check: this is the whole answer, not one entry in it.
    return [{ kind: 'ledger-unreadable', detail: message(error) }];
  }

  for (const workspace of workspaces) {
    let health: LedgerHealth;
    try {
      health = await checkLedgerHealth(database, contextOf(workspace));
    } catch (error) {
      // One workspace that cannot be read is a problem, not the end of the check: the rest are still asked.
      problems.push({ kind: 'ledger-unreadable', detail: message(error) });
      continue;
    }
    if (health.unbalanced.length) {
      problems.push({
        kind: 'unbalanced',
        detail: health.unbalanced.map((r) => `${r.transactionId} ${r.currency} ${r.total}`).join(', '),
      });
    }
    if (health.orphanEntries.length) problems.push({ kind: 'orphan-entries', detail: health.orphanEntries.join(', ') });
    if (health.orphanTransactions.length) problems.push({ kind: 'orphan-transactions', detail: health.orphanTransactions.join(', ') });
  }
  return problems;
}
