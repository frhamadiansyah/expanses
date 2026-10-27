import { uuidv7 } from '@expanses/core';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { auditLog } from '../schema';

/*
 * The Activity page's own record (Settings → Activity). The ledger already writes an audit row for every post and every
 * void, but those rows cannot say WHY: an edit, a delete, a trade's correction and a statement check all look alike. So
 * the doors a person uses — the plain `postTransaction`, `replaceTransaction`, `voidTransaction`, and a bill payment —
 * leave one more row beside theirs, entity 'activity', whose action names what the person did and whose entity id is
 * the transaction it concerns. Internal callers (a trade, a loan, a sale) use the `…Tx` doors and leave none, so the
 * list holds what was changed by hand and nothing the app did on its own behalf. A row is never rewritten.
 */

export type ActivityOp = 'create' | 'edit' | 'delete' | 'payment' | 'archive';

/** One row of the person's own doing. `transactionId` (an account's id for archive) is the new row for create, edit and payment, the voided one for delete. */
export async function recordActivityTx(tx: Db, ws: WorkspaceContext, op: ActivityOp, transactionId: string, payload: Record<string, unknown> = {}): Promise<void> {
  await tx.insert(auditLog).values({
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    action: op,
    entity: 'activity',
    entityId: transactionId,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
  });
}
