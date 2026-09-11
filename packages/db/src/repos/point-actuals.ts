import { and, asc, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { transactions } from '../schema';
import { rewardPrograms, transactionPointActuals } from '../schema-points';
import { PointsError } from './points';

export interface TransactionPointActual {
  transactionId: string;
  /** Points the bank credited for the purchase; one decimal at most. */
  actualPoints: number;
  /** The purchase was edited after the user checked it. */
  editedAfterCheck: boolean;
  recordedAt: string;
}

export type Crediting = 'per_transaction' | 'per_statement';

export async function listTransactionPointActuals(database: Database, ws: WorkspaceContext, programId: string): Promise<TransactionPointActual[]> {
  const rows = await database.db
    .select()
    .from(transactionPointActuals)
    .where(and(eq(transactionPointActuals.programId, programId), eq(transactionPointActuals.workspaceId, ws.workspaceId)))
    .orderBy(asc(transactionPointActuals.recordedAt));
  return rows.map((row) => ({ transactionId: row.transactionId, actualPoints: row.actualPoints, editedAfterCheck: row.editedAfterCheck === 1, recordedAt: row.recordedAt }));
}

/** Records what the bank credited for one purchase, replacing any earlier record and clearing its edited mark. */
export async function recordTransactionPointActual(
  database: Database,
  ws: WorkspaceContext,
  input: { programId: string; transactionId: string; actualPoints: number },
): Promise<void> {
  const tenths = input.actualPoints * 10;
  if (!Number.isFinite(tenths) || Math.abs(tenths - Math.round(tenths)) > 1e-9) throw new PointsError('Actual points must be a number with at most one decimal');
  await database.transaction(async (tx) => {
    const [program] = await tx
      .select({ id: rewardPrograms.id })
      .from(rewardPrograms)
      .where(and(eq(rewardPrograms.id, input.programId), eq(rewardPrograms.workspaceId, ws.workspaceId)));
    if (!program) throw new PointsError('Reward program not found');
    const [purchase] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, input.transactionId), eq(transactions.workspaceId, ws.workspaceId)));
    if (!purchase) throw new PointsError('Purchase not found');
    const recordedAt = new Date().toISOString();
    const actualPoints = Math.round(tenths) / 10;
    await tx
      .insert(transactionPointActuals)
      .values({ workspaceId: ws.workspaceId, programId: input.programId, transactionId: input.transactionId, actualPoints, editedAfterCheck: 0, recordedAt })
      .onConflictDoUpdate({
        target: [transactionPointActuals.programId, transactionPointActuals.transactionId],
        set: { actualPoints, editedAfterCheck: 0, recordedAt },
      });
  });
}

export async function clearTransactionPointActual(database: Database, ws: WorkspaceContext, programId: string, transactionId: string): Promise<void> {
  await database.db
    .delete(transactionPointActuals)
    .where(and(eq(transactionPointActuals.programId, programId), eq(transactionPointActuals.transactionId, transactionId), eq(transactionPointActuals.workspaceId, ws.workspaceId)));
}

/** Whether the user checks points per purchase or per statement. A checking preference, so a linked program stays linked. */
export async function setProgramCrediting(database: Database, ws: WorkspaceContext, programId: string, crediting: Crediting): Promise<void> {
  if (crediting !== 'per_transaction' && crediting !== 'per_statement') throw new PointsError('Crediting must be per purchase or per statement');
  await database.db
    .update(rewardPrograms)
    .set({ crediting })
    .where(and(eq(rewardPrograms.id, programId), eq(rewardPrograms.workspaceId, ws.workspaceId)));
}
