import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { accounts, entries } from '../schema';
import { depositAutomation, depositEvents, depositTerms } from '../schema-assets';

/**
 * The confirmed-event log's side of the ledger's void and edit. A leaf: the ledger calls in here, and nothing here
 * calls the ledger, so the two modules do not import each other.
 */

/**
 * Whether migration 0054 has run. Every read and write of its tables asks first, so a database stopped at an older
 * version has every deposit off and nothing due. A positive answer is remembered per handle; a negative one is not,
 * since migrate() may run later on the same handle.
 */
const automationTables = new WeakMap<Db, boolean>();

export async function automationTablesExist(db: Db): Promise<boolean> {
  if (automationTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'deposit_events'`);
  const exists = rows.length > 0;
  if (exists) automationTables.set(db, true);
  return exists;
}

const postedBy = (ws: WorkspaceContext, transactionId: string) =>
  and(
    eq(depositEvents.workspaceId, ws.workspaceId),
    or(eq(depositEvents.interestTransactionId, transactionId), eq(depositEvents.principalTransactionId, transactionId)),
  );

/**
 * A transaction a confirmed event posted has been voided: the event is reopened, so its proposal comes back and the
 * tax report drops it. Everything the confirm did is taken back with it, so the proposal returns as it was:
 * - the log row is deleted;
 * - a roll-over's new term is taken back to the maturity (while nothing later has been logged on it);
 * - a close re-opens the deposit and turns its automation back on.
 *
 * Returns the event's other posting (a close's interest or principal), for the ledger to void through its own path:
 * an event is confirmed whole, so it is reopened whole. Hand-recorded events posted nothing and never reach here.
 */
export async function reopenDepositEventTx(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<string[]> {
  if (!(await automationTablesExist(tx))) return [];
  const [event] = await tx.select().from(depositEvents).where(postedBy(ws, transactionId));
  if (!event) return [];
  await tx.delete(depositEvents).where(eq(depositEvents.id, event.id));
  if (event.kind !== 'maturity') return [];

  const now = new Date().toISOString();
  const [settings] = await tx.select().from(depositAutomation).where(eq(depositAutomation.accountId, event.accountId));
  if (event.principalTransactionId === null) {
    // A roll-over: its confirm moved the maturity on and started a term on the due day. Take that term back, unless
    // something of the new term is already logged, which would be left without a term of its own.
    const [later] = await tx
      .select({ id: depositEvents.id })
      .from(depositEvents)
      .where(and(eq(depositEvents.accountId, event.accountId), gt(depositEvents.dueOn, event.dueOn)));
    if (!later && settings?.termStartedOn === event.dueOn) {
      await tx.update(depositTerms).set({ maturesOn: event.dueOn }).where(eq(depositTerms.accountId, event.accountId));
      // With no stored start, the term is dated back from the maturity by its length.
      await tx.update(depositAutomation).set({ termStartedOn: null, updatedAt: now }).where(eq(depositAutomation.accountId, event.accountId));
    }
    return [];
  }

  // A close: its confirm switched automation off and archived the deposit. Both are undone.
  await tx
    .update(depositAutomation)
    .set({ enabled: 1, enabledOn: settings?.enabledOn ?? event.dueOn, updatedAt: now })
    .where(eq(depositAutomation.accountId, event.accountId));
  await tx
    .update(accounts)
    .set({ archivedAt: null })
    .where(and(eq(accounts.id, event.accountId), eq(accounts.workspaceId, ws.workspaceId)));
  return [event.interestTransactionId, event.principalTransactionId].filter((id): id is string => id !== null && id !== transactionId);
}

/**
 * A transaction a confirmed event posted has been edited (voided and replaced as one step). The event stays done;
 * the log follows the replacement and takes its figures: the gross is what its income lines credit, the tax what
 * its expense lines debit, the principal what left the deposit.
 */
export async function followDepositEventTx(tx: Db, ws: WorkspaceContext, fromId: string, toId: string): Promise<void> {
  if (!(await automationTablesExist(tx))) return;
  const [event] = await tx.select().from(depositEvents).where(postedBy(ws, fromId));
  if (!event) return;
  const lines = await tx
    .select({ accountId: entries.accountId, amountMinor: entries.amountMinor, kind: accounts.kind })
    .from(entries)
    .innerJoin(accounts, eq(accounts.id, entries.accountId))
    .where(inArray(entries.transactionId, [toId]));
  const sum = (keep: (line: (typeof lines)[number]) => boolean) => lines.filter(keep).reduce((total, line) => total + line.amountMinor, 0);

  if (event.interestTransactionId === fromId) {
    const grossMinor = Math.max(0, -sum((line) => line.kind === 'income'));
    const taxMinor = Math.max(0, sum((line) => line.kind === 'expense'));
    await tx
      .update(depositEvents)
      .set({ interestTransactionId: toId, grossMinor, taxMinor, netMinor: grossMinor - taxMinor })
      .where(eq(depositEvents.id, event.id));
  } else {
    const principalMinor = Math.max(0, -sum((line) => line.accountId === event.accountId));
    await tx.update(depositEvents).set({ principalTransactionId: toId, principalMinor }).where(eq(depositEvents.id, event.id));
  }
}
