import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { checkLedgerIntegrity } from './ledger';
import { contextOf, listWorkspaces } from './workspaces';

export interface IntegrityProblem {
  kind: 'quick_check' | 'integrity_check' | 'unbalanced' | 'orphan-entries' | 'orphan-transactions';
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

/** Everything, in the order that costs least: the file first, then each workspace's ledger. */
export async function checkDatabase(database: Database, options: { deep?: boolean } = {}): Promise<IntegrityProblem[]> {
  const structure = await checkStructure(database, options.deep ? 'integrity_check' : 'quick_check');
  // A malformed file cannot be asked anything else; asking would only throw.
  if (structure.length) return structure;

  const problems: IntegrityProblem[] = [];
  for (const workspace of await listWorkspaces(database)) {
    const health = await checkLedgerHealth(database, contextOf(workspace));
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
