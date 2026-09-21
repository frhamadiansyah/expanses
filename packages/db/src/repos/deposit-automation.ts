import {
  DEFAULT_TAX_BPS,
  type DepositEvent,
  type DepositSchedule,
  depositInterest,
  dueDepositEvents,
  eventKey,
  type InterestPaid,
  type MaturityChoice,
  TERM_MONTHS,
  type TermMonths,
  withholdTax,
} from '@expanses/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { depositAutomation, depositEvents, depositTerms } from '../schema-assets';
import { type AccountRow, SPENDABLE_SUBTYPES } from './accounts';
import type { DepositTermsRow } from './deposit-terms';
import { nativeBalances } from './ledger';

export type DepositAutomationErrorCode =
  | 'NOT_READY'
  | 'NOT_FOUND'
  | 'BAD_PAYOUT'
  | 'BAD_TERM'
  | 'BAD_TAX'
  | 'OFF'
  | 'NOT_NEXT'
  | 'BAD_FIGURE'
  | 'NO_PAYOUT';

export class DepositAutomationError extends Error {
  readonly code: DepositAutomationErrorCode;

  constructor(code: DepositAutomationErrorCode, message: string) {
    super(message);
    this.name = 'DepositAutomationError';
    this.code = code;
  }
}

/**
 * Whether migration 0054 has run. Every read and write here asks first, so a database stopped at an older version
 * has every deposit off and nothing due. A positive answer is remembered per handle; a negative one is not, since
 * migrate() may run later on the same handle.
 */
const automationTables = new WeakMap<Db, boolean>();

export async function automationTablesExist(db: Db): Promise<boolean> {
  if (automationTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'deposit_events'`);
  const exists = rows.length > 0;
  if (exists) automationTables.set(db, true);
  return exists;
}

export interface DepositAutomationSettings {
  enabled: boolean;
  enabledOn: string | null;
  atMaturity: MaturityChoice;
  interestPaid: InterestPaid;
  payoutAccountId: string | null;
  termMonths: TermMonths;
  termStartedOn: string | null;
  keepRate: boolean;
  taxBps: number;
  taxExempt: boolean;
}

export interface DepositAutomationRow extends DepositAutomationSettings {
  accountId: string;
}

/** What a deposit with no row reads as: off, and the defaults the S2 group shows when it is first switched on. */
export const AUTOMATION_DEFAULTS: DepositAutomationSettings = {
  enabled: false,
  enabledOn: null,
  atMaturity: 'principal',
  interestPaid: 'at_maturity',
  payoutAccountId: null,
  termMonths: 1,
  termStartedOn: null,
  keepRate: true,
  taxBps: DEFAULT_TAX_BPS,
  taxExempt: false,
};

type AutomationRecord = typeof depositAutomation.$inferSelect;

const fromRecord = (r: AutomationRecord): DepositAutomationRow => ({
  accountId: r.accountId,
  enabled: r.enabled === 1,
  enabledOn: r.enabledOn,
  atMaturity: r.atMaturity,
  interestPaid: r.interestPaid,
  payoutAccountId: r.payoutAccountId,
  termMonths: r.termMonths as TermMonths,
  termStartedOn: r.termStartedOn,
  keepRate: r.keepRate === 1,
  taxBps: r.taxBps,
  taxExempt: r.taxExempt === 1,
});

async function automationTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<DepositAutomationRow | undefined> {
  const [row] = await tx
    .select()
    .from(depositAutomation)
    .where(and(eq(depositAutomation.accountId, accountId), eq(depositAutomation.workspaceId, ws.workspaceId)));
  return row ? fromRecord(row) : undefined;
}

export async function getDepositAutomation(database: Database, ws: WorkspaceContext, accountId: string): Promise<DepositAutomationRow> {
  const found = (await automationTablesExist(database.db)) ? await automationTx(database.db, ws, accountId) : undefined;
  return found ?? { accountId, ...AUTOMATION_DEFAULTS };
}

interface LiveDeposit {
  id: string;
  name: string;
  currency: string;
}

/** A time deposit of this workspace that is still open. Anything else is refused, whatever the caller thought it had. */
async function liveDepositTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<LiveDeposit> {
  const [row] = await tx
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency, subtype: accounts.subtype, archivedAt: accounts.archivedAt })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!row || row.subtype !== 'time_deposit' || row.archivedAt !== null || row.currency === null) {
    throw new DepositAutomationError('NOT_FOUND', 'That deposit is not open in this workspace');
  }
  return { id: row.id, name: row.name, currency: row.currency };
}

/**
 * Where money may land: an open, spendable asset account holding the deposit's own currency, and not the deposit.
 * The one statement of the rule. The repo refuses by it and the web offers by it, so the list never offers a refusal.
 */
export function payoutAccepts(
  account: Pick<AccountRow, 'id' | 'kind' | 'subtype' | 'currency' | 'archivedAt'>,
  currency: string,
  depositId: string,
): boolean {
  return (
    account.id !== depositId &&
    account.kind === 'asset' &&
    account.archivedAt === null &&
    account.currency === currency &&
    SPENDABLE_SUBTYPES.includes(account.subtype)
  );
}

async function checkPayoutTx(tx: Db, ws: WorkspaceContext, payoutAccountId: string, currency: string, depositId: string): Promise<void> {
  const [row] = await tx
    .select({ id: accounts.id, subtype: accounts.subtype, currency: accounts.currency, archivedAt: accounts.archivedAt, kind: accounts.kind })
    .from(accounts)
    .where(and(eq(accounts.id, payoutAccountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!row || !payoutAccepts(row, currency, depositId)) {
    throw new DepositAutomationError('BAD_PAYOUT', `Choose an open account in this workspace that holds ${currency} and that money can land in`);
  }
}

export interface SaveDepositAutomationInput {
  accountId: string;
  enabled: boolean;
  atMaturity: MaturityChoice;
  interestPaid: InterestPaid;
  payoutAccountId: string | null;
  termMonths: TermMonths;
  keepRate: boolean;
  taxBps: number;
  taxExempt: boolean;
  /** Local YYYY-MM-DD: becomes `enabledOn` when this save turns the switch on. */
  today: string;
}

/** Writes a deposit's settings. A missing payout is allowed here and refused at confirm, where it matters. */
export async function saveDepositAutomation(database: Database, ws: WorkspaceContext, input: SaveDepositAutomationInput): Promise<void> {
  if (!(TERM_MONTHS as readonly number[]).includes(input.termMonths)) throw new DepositAutomationError('BAD_TERM', 'A term is 1, 3, 6 or 12 months');
  if (!Number.isInteger(input.taxBps) || input.taxBps < 0 || input.taxBps > 10_000) {
    throw new DepositAutomationError('BAD_TAX', 'Tax withheld is a percentage from 0 to 100, to two decimals');
  }
  await database.transaction(async (tx) => {
    if (!(await automationTablesExist(tx))) throw new DepositAutomationError('NOT_READY', 'Update the app to automate a deposit');
    const deposit = await liveDepositTx(tx, ws, input.accountId);
    if (input.payoutAccountId !== null) await checkPayoutTx(tx, ws, input.payoutAccountId, deposit.currency, deposit.id);
    const before = await automationTx(tx, ws, deposit.id);
    const enabledOn = input.enabled ? (before?.enabled ? before.enabledOn : input.today) : null;
    const values = {
      accountId: deposit.id,
      workspaceId: ws.workspaceId,
      enabled: input.enabled ? 1 : 0,
      enabledOn,
      atMaturity: input.atMaturity,
      interestPaid: input.interestPaid,
      payoutAccountId: input.payoutAccountId,
      termMonths: input.termMonths,
      termStartedOn: before?.termStartedOn ?? null,
      keepRate: input.keepRate ? 1 : 0,
      taxBps: input.taxBps,
      taxExempt: input.taxExempt ? 1 : 0,
      updatedAt: new Date().toISOString(),
    };
    const { accountId, workspaceId, ...changes } = values;
    await tx.insert(depositAutomation).values(values).onConflictDoUpdate({ target: depositAutomation.accountId, set: changes });
  });
}

function scheduleOf(settings: DepositAutomationRow, terms: Pick<DepositTermsRow, 'maturesOn'>): DepositSchedule {
  return {
    maturesOn: terms.maturesOn,
    termMonths: settings.termMonths,
    termStartedOn: settings.termStartedOn,
    interestPaid: settings.interestPaid,
    // Only read while enabled, when it is always set; the maturity is a harmless floor otherwise.
    enabledOn: settings.enabledOn ?? terms.maturesOn,
  };
}

async function doneKeysTx(db: Db, ws: WorkspaceContext, accountId: string): Promise<Set<string>> {
  const rows = await db
    .select({ kind: depositEvents.kind, dueOn: depositEvents.dueOn })
    .from(depositEvents)
    .where(and(eq(depositEvents.workspaceId, ws.workspaceId), eq(depositEvents.accountId, accountId)));
  return new Set(rows.map((row) => eventKey(row.kind, row.dueOn)));
}

export interface DepositProposal {
  accountId: string;
  name: string;
  currency: string;
  /** The earliest due event: the only one proposed. */
  event: DepositEvent;
  /** How many more are due after it. Each is worked out once the one before it is confirmed. */
  waiting: number;
  /** The deposit's balance at the end of the due day. */
  principalMinor: number;
  rateBps: number;
  grossMinor: number;
  taxMinor: number;
  netMinor: number;
  settings: DepositAutomationRow;
}

/** Every automated deposit of the workspace with something due today or earlier, soonest first. */
export async function listDueDeposits(database: Database, ws: WorkspaceContext, today: string): Promise<DepositProposal[]> {
  if (!(await automationTablesExist(database.db))) return [];
  const rows = await database.db
    .select({ automation: depositAutomation, terms: depositTerms, name: accounts.name, currency: accounts.currency })
    .from(depositAutomation)
    .innerJoin(depositTerms, eq(depositTerms.accountId, depositAutomation.accountId))
    .innerJoin(accounts, eq(accounts.id, depositAutomation.accountId))
    .where(
      and(
        eq(depositAutomation.workspaceId, ws.workspaceId),
        eq(accounts.workspaceId, ws.workspaceId),
        eq(depositAutomation.enabled, 1),
        isNull(accounts.archivedAt),
      ),
    );
  const proposals: DepositProposal[] = [];
  for (const row of rows) {
    if (row.currency === null) continue;
    const settings = fromRecord(row.automation);
    const due = dueDepositEvents(scheduleOf(settings, row.terms), await doneKeysTx(database.db, ws, settings.accountId), today);
    const [event] = due;
    if (!event) continue;
    // The existing balance reader, as of the due day: a payout posted into the deposit earlier in the term is in it.
    const principalMinor = (await nativeBalances(database, ws, event.dueOn))[settings.accountId] ?? 0;
    const grossMinor = depositInterest(principalMinor, row.terms.rateBps, event.days);
    const { taxMinor, netMinor } = withholdTax(grossMinor, settings.taxBps, settings.taxExempt);
    proposals.push({
      accountId: settings.accountId,
      name: row.name,
      currency: row.currency,
      event,
      waiting: due.length - 1,
      principalMinor,
      rateBps: row.terms.rateBps,
      grossMinor,
      taxMinor,
      netMinor,
      settings,
    });
  }
  return proposals.sort((a, b) => a.event.dueOn.localeCompare(b.event.dueOn));
}
