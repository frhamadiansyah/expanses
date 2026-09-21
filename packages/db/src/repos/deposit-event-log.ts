import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { accounts, entries } from '../schema';
import { depositAutomation, depositEvents, depositTerms } from '../schema-assets';
// accounts.ts reaches the ledger, which calls in here: a cycle of function calls only, resolved long before any runs.
import { postedBalanceTx, unarchiveAccountTx } from './accounts';
import { categoryIdsByKeyAllTx } from './categories';
import { saveDepositTermsTx } from './deposit-terms';

/**
 * The confirmed-event log's side of the ledger's void and edit. A leaf: the ledger calls in here, and nothing here
 * calls the ledger, so the two modules do not import each other.
 */

export type DepositAutomationErrorCode =
  | 'NOT_READY'
  | 'NOT_FOUND'
  | 'BAD_PAYOUT'
  | 'BAD_TERM'
  | 'BAD_TAX'
  | 'OFF'
  | 'NOT_NEXT'
  | 'BAD_FIGURE'
  | 'NO_PAYOUT'
  | 'NOT_LAST';

/** Lives in this leaf so the void hook can refuse with it; `deposit-automation` re-exports it. */
export class DepositAutomationError extends Error {
  readonly code: DepositAutomationErrorCode;

  constructor(code: DepositAutomationErrorCode, message: string) {
    super(message);
    this.name = 'DepositAutomationError';
    this.code = code;
  }
}

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
 * - a roll-over's new term is taken back to the maturity;
 * - a close re-opens the deposit and turns its automation back on.
 * Refused (NOT_LAST, which rolls the whole void back) while a later event of the deposit is logged across a maturity.
 *
 * Returns the event's other posting (a close's interest or principal), for the ledger to void through its own path:
 * an event is confirmed whole, so it is reopened whole. Hand-recorded events posted nothing and never reach here.
 */
export async function reopenDepositEventTx(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<string[]> {
  if (!(await automationTablesExist(tx))) return [];
  const [event] = await tx.select().from(depositEvents).where(postedBy(ws, transactionId));
  if (!event) return [];
  // Reopening is last in, first out. A maturity started the term that every later event belongs to, and only the
  // current term is ever proposed: reopening a maturity with anything logged after it, or anything before a maturity
  // that is logged, would drop an event nothing proposes again. The owner voids the later one first.
  // Scoped to the workspace as every read is (pinned by a test), though the account id alone already is one deposit.
  const later = await tx
    .select({ kind: depositEvents.kind })
    .from(depositEvents)
    .where(and(eq(depositEvents.workspaceId, ws.workspaceId), eq(depositEvents.accountId, event.accountId), gt(depositEvents.dueOn, event.dueOn)));
  if (later.length > 0 && (event.kind === 'maturity' || later.some((row) => row.kind === 'maturity'))) {
    throw new DepositAutomationError('NOT_LAST', 'A later payout of this deposit is recorded. Void that one first, then this one.');
  }
  await tx.delete(depositEvents).where(eq(depositEvents.id, event.id));
  if (event.kind !== 'maturity') return [];

  const now = new Date().toISOString();
  const [settings] = await tx.select().from(depositAutomation).where(eq(depositAutomation.accountId, event.accountId));
  if (event.principalTransactionId === null) {
    // A roll-over: its confirm moved the maturity on and started a term on the due day. Take that term back.
    // Defence in depth, unreachable today: only a later roll-over moves termStartedOn off this due day, and NOT_LAST
    // above refuses while one is logged, so this is always true here (D3 review m-3). Kept so that a future path that
    // moves the start some other way leaves the owner's term alone rather than rewinding it.
    if (settings?.termStartedOn === event.dueOn) {
      // The rate, the term's length and its start go back to what the confirm replaced (logged with the event).
      const [terms] = await tx.select({ rateBps: depositTerms.rateBps }).from(depositTerms).where(eq(depositTerms.accountId, event.accountId));
      await saveDepositTermsTx(tx, ws, { accountId: event.accountId, maturesOn: event.dueOn, rateBps: event.priorRateBps ?? terms?.rateBps ?? 0 });
      await tx
        .update(depositAutomation)
        .set({ termMonths: event.priorTermMonths ?? settings.termMonths, termStartedOn: event.priorTermStartedOn, updatedAt: now })
        .where(eq(depositAutomation.accountId, event.accountId));
    }
    return [];
  }

  // A close: its confirm switched automation off and archived the deposit. Both are undone.
  await tx
    .update(depositAutomation)
    .set({ enabled: 1, enabledOn: settings?.enabledOn ?? event.dueOn, updatedAt: now })
    .where(eq(depositAutomation.accountId, event.accountId));
  await unarchiveAccountTx(tx, ws, event.accountId);
  return [event.interestTransactionId, event.principalTransactionId].filter((id): id is string => id !== null && id !== transactionId);
}

/**
 * A transaction a confirmed event posted has been edited (voided and replaced as one step). The event stays done;
 * the log follows the replacement and takes its figures: the gross is what its income lines credit, the tax what
 * its tax category's line debits, the principal what left the deposit. A close edited to leave money in the deposit
 * un-archives it.
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
    // Only the tax line the confirm posted (tradeAccountsFor's category): a fee added on an edit is not tax withheld.
    // Every book's copy of the key, not the open book's: an edit made while another book is open still finds it.
    const taxCategoryIds = new Set((await categoryIdsByKeyAllTx(tx, ws))['government_taxes.estimated_tax'] ?? []);
    // A credit on that line is a refund, not tax withheld: the log never holds a tax below zero (confirm refuses one
    // too), so it reads as none, and the log keeps gross = net + tax.
    const taxMinor = Math.max(0, sum((line) => taxCategoryIds.has(line.accountId)));
    await tx
      .update(depositEvents)
      .set({ interestTransactionId: toId, grossMinor, taxMinor, netMinor: grossMinor - taxMinor })
      .where(eq(depositEvents.id, event.id));
  } else {
    const principalMinor = Math.max(0, -sum((line) => line.accountId === event.accountId));
    await tx.update(depositEvents).set({ principalTransactionId: toId, principalMinor }).where(eq(depositEvents.id, event.id));
    // A close edited to take less than the deposit holds leaves money in it. As at confirm (spec §6.4, step 6), a
    // deposit holding money stays open, with its automation off, so net worth still shows it.
    const [deposit] = await tx.select({ archivedAt: accounts.archivedAt }).from(accounts).where(eq(accounts.id, event.accountId));
    if (deposit && deposit.archivedAt !== null && (await postedBalanceTx(tx, event.accountId)) !== 0) {
      await unarchiveAccountTx(tx, ws, event.accountId);
    }
  }
}
