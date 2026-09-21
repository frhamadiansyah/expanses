import {
  addMonthsToDate,
  DEFAULT_TAX_BPS,
  type DepositEvent,
  type DepositSchedule,
  depositInterest,
  dueDepositEvents,
  eventKey,
  type InterestPaid,
  type MaturityChoice,
  needsPayout,
  positionAfter,
  TERM_MONTHS,
  type TermMonths,
  type TradeRecord,
  tradePostings,
  transferLines,
  uuidv7,
  withholdTax,
} from '@expanses/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { depositAutomation, depositEvents, depositTerms } from '../schema-assets';
import { AccountError, type AccountRow, archiveAccountTx, postedBalanceTx, SPENDABLE_SUBTYPES } from './accounts';
import { automationTablesExist, DepositAutomationError, type DepositAutomationErrorCode } from './deposit-event-log';
import { type DepositTermsRow, getDepositTermsTx, saveDepositTermsTx } from './deposit-terms';
import { nativeBalances, postTransactionTx } from './ledger';
import { tradeAccountsFor } from './trades';

export { automationTablesExist, DepositAutomationError, type DepositAutomationErrorCode };

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

export interface ConfirmDepositEventInput {
  accountId: string;
  kind: DepositEvent['kind'];
  dueOn: string;
  /** Local YYYY-MM-DD, to check that this event is still the earliest due. */
  today: string;
  /** Posted only when the deposit does not roll over; logged either way. */
  principalMinor: number;
  /** Interest before tax, as it posts to `income.investment`: the computed figure, or the bank's, typed. */
  grossMinor: number;
  /** Tax withheld, as it posts to `government_taxes.estimated_tax`. What lands is `grossMinor − taxMinor`. */
  taxMinor: number;
  /** Maturity with a roll-over only. */
  newRateBps?: number;
  newTermMonths?: TermMonths;
  /** Units of base per one major unit of the deposit's currency, when that is not the base. */
  rateToBase?: number;
  /**
   * "Recorded it myself": the owner already put it in the ledger. Nothing is posted. The event is marked done with
   * the figures on the card, so the tax report still has it. A roll-over still starts its next term.
   */
  byHand?: boolean;
}

export interface ConfirmedDepositEvent {
  interestTransactionId: string | null;
  principalTransactionId: string | null;
  /** What landed (or, recorded by hand, what the owner said landed): gross − tax. */
  netMinor: number;
  archived: boolean;
}

const whole = (n: number | undefined): n is number => n !== undefined && Number.isSafeInteger(n) && n >= 0;

/**
 * Posts one due event through the ledger's own paths and marks it done, all in one transaction. The interest posts the
 * way an investment payment does (`tradeAccountsFor` + `tradePostings`). Refuses anything that is not the earliest due
 * event of an automated, open deposit of this workspace.
 */
export async function confirmDepositEvent(database: Database, ws: WorkspaceContext, input: ConfirmDepositEventInput): Promise<ConfirmedDepositEvent> {
  if (!whole(input.grossMinor) || !whole(input.taxMinor) || !whole(input.principalMinor) || input.taxMinor > input.grossMinor) {
    throw new DepositAutomationError('BAD_FIGURE', 'Every figure is a whole amount, not below zero, and the tax is not more than the interest');
  }
  const byHand = input.byHand === true;
  const netMinor = input.grossMinor - input.taxMinor;
  // The ledger refuses a zero line (ZERO_AMOUNT); say why in words before it gets there.
  if (!byHand && input.grossMinor > 0 && netMinor === 0) throw new DepositAutomationError('BAD_FIGURE', 'The tax cannot take all of the interest');

  return database.transaction(async (tx) => {
    if (!(await automationTablesExist(tx))) throw new DepositAutomationError('NOT_READY', 'Update the app to automate a deposit');
    const deposit = await liveDepositTx(tx, ws, input.accountId);
    const settings = await automationTx(tx, ws, deposit.id);
    const terms = await getDepositTermsTx(tx, ws, deposit.id);
    if (!settings?.enabled || !terms) throw new DepositAutomationError('OFF', 'Automation is off for this deposit');

    const [first] = dueDepositEvents(scheduleOf(settings, terms), await doneKeysTx(tx, ws, deposit.id), input.today);
    if (!first || first.kind !== input.kind || first.dueOn !== input.dueOn) {
      throw new DepositAutomationError('NOT_NEXT', 'This is not the next thing due on this deposit. Reopen it to see what is.');
    }

    const maturity = input.kind === 'maturity';
    const closing = maturity && settings.atMaturity === 'close';
    const rolling = maturity && !closing;
    const lands = needsPayout(settings.atMaturity);
    if (!byHand && lands) {
      if (settings.payoutAccountId === null) throw new DepositAutomationError('NO_PAYOUT', 'Choose the account the money lands in first');
      await checkPayoutTx(tx, ws, settings.payoutAccountId, deposit.currency, deposit.id);
    }
    if (closing && !byHand && input.principalMinor <= 0) throw new DepositAutomationError('BAD_FIGURE', 'Say how much came back');
    // Proposed from the due day's balance (spec §5); money that left since then cannot come back twice. A close never
    // drives the deposit below zero: it is refused, and the owner types what it holds now.
    if (closing && !byHand && input.principalMinor > (await postedBalanceTx(tx, deposit.id))) {
      throw new DepositAutomationError('BAD_FIGURE', 'The deposit holds less than that now. Type what came back.');
    }
    if (rolling && (!(TERM_MONTHS as readonly number[]).includes(input.newTermMonths ?? 0) || !whole(input.newRateBps))) {
      throw new DepositAutomationError('BAD_FIGURE', 'A roll-over needs its new term and rate');
    }

    const ratesToBase = deposit.currency !== ws.baseCurrency && input.rateToBase !== undefined ? { [deposit.currency]: input.rateToBase } : {};

    let interestTransactionId: string | null = null;
    if (!byHand && input.grossMinor > 0) {
      const interestInto = lands ? settings.payoutAccountId! : deposit.id;
      // The investment payment's own accounts and lines: net to where it lands, tax to estimated_tax, gross to income.
      const { accounts: tradeAccounts } = await tradeAccountsFor(tx, ws, deposit.id, interestInto);
      interestTransactionId = await postTransactionTx(tx, ws, {
        occurredOn: input.dueOn,
        description: `Interest: ${deposit.name}`,
        lines: tradePostings(
          { kind: 'income', occurredOn: input.dueOn, unitsMicro: 0, grossMinor: input.grossMinor, feeMinor: 0, taxMinor: input.taxMinor },
          positionAfter([]),
          tradeAccounts,
        ),
        ratesToBase,
      });
    }

    let principalTransactionId: string | null = null;
    if (closing && !byHand) {
      principalTransactionId = await postTransactionTx(tx, ws, {
        occurredOn: input.dueOn,
        description: `${deposit.name} matured`,
        lines: transferLines({ fromAccountId: deposit.id, toAccountId: settings.payoutAccountId!, amountMinor: input.principalMinor, currency: deposit.currency }),
        ratesToBase,
      });
    }

    const now = new Date().toISOString();
    if (rolling) {
      await saveDepositTermsTx(tx, ws, { accountId: deposit.id, maturesOn: addMonthsToDate(input.dueOn, input.newTermMonths!), rateBps: input.newRateBps! });
      await tx
        .update(depositAutomation)
        .set({ termMonths: input.newTermMonths!, termStartedOn: input.dueOn, updatedAt: now })
        .where(eq(depositAutomation.accountId, deposit.id));
    }

    await tx.insert(depositEvents).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      accountId: deposit.id,
      kind: input.kind,
      dueOn: input.dueOn,
      principalMinor: input.principalMinor,
      grossMinor: input.grossMinor,
      taxMinor: input.taxMinor,
      netMinor,
      interestTransactionId,
      principalTransactionId,
      recordedByHand: byHand ? 1 : 0,
      // What the roll-over replaced, so a reopen can put it back.
      priorRateBps: rolling ? terms.rateBps : null,
      priorTermMonths: rolling ? settings.termMonths : null,
      priorTermStartedOn: rolling ? settings.termStartedOn : null,
      confirmedAt: now,
    });

    let archived = false;
    if (closing) {
      await tx.update(depositAutomation).set({ enabled: 0, enabledOn: null, updatedAt: now }).where(eq(depositAutomation.accountId, deposit.id));
      try {
        // The archive keeps its own refusal: it checks the balance and throws before it writes anything.
        await archiveAccountTx(tx, ws, deposit.id);
        archived = true;
      } catch (error) {
        if (!(error instanceof AccountError)) throw error;
      }
    }
    return { interestTransactionId, principalTransactionId, netMinor, archived };
  });
}

/**
 * Every confirmed or hand-recorded event with interest, as the income payment the tax report already reads: gross and
 * tax withheld, dated the due day. The report's reader filters the year; this passes every event of the workspace.
 */
export async function depositIncomePayments(database: Database, ws: WorkspaceContext): Promise<TradeRecord[]> {
  if (!(await automationTablesExist(database.db))) return [];
  const rows = await database.db.select().from(depositEvents).where(eq(depositEvents.workspaceId, ws.workspaceId));
  return rows
    .filter((row) => row.grossMinor > 0)
    .map((row) => ({
      id: row.id,
      accountId: row.accountId,
      kind: 'income' as const,
      occurredOn: row.dueOn,
      createdAt: row.confirmedAt,
      unitsMicro: 0,
      grossMinor: row.grossMinor,
      feeMinor: 0,
      taxMinor: row.taxMinor,
    }));
}
