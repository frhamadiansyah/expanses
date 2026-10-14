import type { PostingLine } from '@expanses/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { transactions } from '../schema';
import { exactOrNull } from './exact-column';
import { postTransactionTx } from './ledger';

export interface ImportRow {
  occurredOn: string;
  description: string;
  /** Positive = money out of the account or card charge; negative = money in, payment, or refund. */
  amountMinor: number;
  /**
   * For a currency with no minor unit, the row's figure with cents in hundredths (always positive), as `mapCsvRows`
   * reads it; `amountMinor` is then that figure rounded by the row's sign. Absent or null for a whole figure.
   */
  exactHundredths?: number | null;
  externalRef: string;
  /** Expense or income category the other side posts to. */
  categoryAccountId: string;
}

export async function existingExternalRefs(database: Database, ws: WorkspaceContext, refs: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < refs.length; i += 500) {
    const chunk = refs.slice(i, i + 500);
    const rows = await database.db
      .select({ ref: transactions.externalRef })
      .from(transactions)
      .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), inArray(transactions.externalRef, chunk)));
    for (const r of rows) if (r.ref) found.add(r.ref);
  }
  return found;
}

/** Posts all non-duplicate rows in one database transaction: every row posts, or none do. */
export async function importRows(
  database: Database,
  ws: WorkspaceContext,
  input: { accountId: string; currency: string; rows: ImportRow[]; ratesToBaseByDate?: Record<string, Record<string, number>> },
): Promise<{ imported: number; skipped: number }> {
  const existing = await existingExternalRefs(database, ws, input.rows.map((r) => r.externalRef));
  return database.transaction(async (tx) => {
    let imported = 0;
    let skipped = 0;
    for (const row of input.rows) {
      if (existing.has(row.externalRef)) {
        skipped++;
        continue;
      }
      const lines: PostingLine[] = [
        { accountId: row.categoryAccountId, amountMinor: row.amountMinor, currency: input.currency },
        { accountId: input.accountId, amountMinor: -row.amountMinor, currency: input.currency },
      ];
      await postTransactionTx(tx, ws, {
        occurredOn: row.occurredOn,
        description: row.description,
        source: 'csv',
        externalRef: row.externalRef,
        lines,
        // A statement's cents are kept only while the row's amount rounds from them: an import never fails over them.
        exactHundredths: exactOrNull(row.exactHundredths, lines),
        ratesToBase: input.ratesToBaseByDate?.[row.occurredOn] ?? {},
      });
      existing.add(row.externalRef);
      imported++;
    }
    return { imported, skipped };
  });
}
