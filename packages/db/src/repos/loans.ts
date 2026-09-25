import {
  debtItem,
  extraPaymentEffect,
  type LoanMethod,
  type LoanTerms,
  loanSchedule,
  periodOn,
  type PostingLine,
  type RatePeriod,
  type ScheduleRow,
  uuidv7,
} from '@expanses/core';
import { and, asc, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries, transactions } from '../schema';
import { loanItems, loanRatePeriods, loanTerms } from '../schema-loans';
import { categoryIdsByKeyTx } from './categories';
import { postTransactionTx } from './ledger';
import type { SetAsideChoice } from './set-aside-tx';

export class LoanDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoanDbError';
  }
}

export interface RatePeriodRow {
  id: string;
  accountId: string;
  fromOn: string;
  rateBps: number;
  kind: 'fixed' | 'floating';
  paymentMinor: number;
}

export interface LoanTermsRow {
  accountId: string;
  workspaceId: string;
  lenderName: string;
  lenderNpwp: string | null;
  purpose: string | null;
  originalMinor: number;
  firstPaymentOn: string;
  tenorMonths: number;
  method: LoanMethod;
  paymentDay: number;
  assetAccountId: string | null;
  coretaxCode: string;
  status: 'open' | 'paid_off';
  statusOn: string | null;
  /** Derived: a loan against a property is a mortgage, and leaves the non-mortgage ratio alone. */
  isHomeLoan: boolean;
  periods: RatePeriodRow[];
}

export interface SaveLoanTermsInput {
  accountId: string;
  lenderName: string;
  lenderNpwp?: string | null;
  purpose?: string | null;
  originalMinor: number;
  firstPaymentOn: string;
  tenorMonths: number;
  method: LoanMethod;
  paymentDay: number;
  assetAccountId?: string | null;
  coretaxCode?: string;
  /** The rate it starts on. Later changes go through `addRatePeriod`. */
  rateBps: number;
  paymentMinor?: number;
  rateKind?: 'fixed' | 'floating';
}

const DEFAULT_CORETAX_CODE = '101';

/** The account a loan lives on. Only a liability of subtype `loan` may carry terms. */
async function loanAccountTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<{ currency: string }> {
  const [row] = await tx
    .select({ subtype: accounts.subtype, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!row) throw new LoanDbError('Account not found in this workspace');
  if (row.subtype !== 'loan') throw new LoanDbError('Only a loan account can carry loan terms');
  return { currency: row.currency ?? ws.baseCurrency };
}

/** Adds or updates what a loan was agreed on. The balance itself stays in the ledger. */
export async function saveLoanTerms(database: Database, ws: WorkspaceContext, input: SaveLoanTermsInput): Promise<void> {
  const lenderName = input.lenderName.trim();
  if (!lenderName) throw new LoanDbError('Say who lent the money');
  if (!Number.isInteger(input.tenorMonths) || input.tenorMonths < 1) throw new LoanDbError('A loan runs for at least one month');
  if (!Number.isInteger(input.paymentDay) || input.paymentDay < 1 || input.paymentDay > 28) {
    throw new LoanDbError('Pick a payment day between 1 and 28, so every month has it');
  }
  if (!(input.originalMinor > 0)) throw new LoanDbError('A loan needs an amount greater than zero');

  await database.transaction(async (tx) => {
    await loanAccountTx(tx, ws, input.accountId);
    if (input.assetAccountId) {
      const [asset] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, input.assetAccountId), eq(accounts.workspaceId, ws.workspaceId)));
      if (!asset) throw new LoanDbError('That asset is not in this workspace');
    }

    const [existing] = await tx
      .select({ accountId: loanTerms.accountId, status: loanTerms.status, statusOn: loanTerms.statusOn, createdAt: loanTerms.createdAt })
      .from(loanTerms)
      .where(and(eq(loanTerms.accountId, input.accountId), eq(loanTerms.workspaceId, ws.workspaceId)));

    const values = {
      accountId: input.accountId,
      workspaceId: ws.workspaceId,
      lenderName,
      lenderNpwp: input.lenderNpwp ?? null,
      purpose: input.purpose ?? null,
      originalMinor: input.originalMinor,
      firstPaymentOn: input.firstPaymentOn,
      tenorMonths: input.tenorMonths,
      method: input.method,
      paymentDay: input.paymentDay,
      assetAccountId: input.assetAccountId ?? null,
      coretaxCode: input.coretaxCode ?? DEFAULT_CORETAX_CODE,
      status: existing?.status ?? ('open' as const),
      statusOn: existing?.statusOn ?? null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const { createdAt, ...changes } = values;
    await tx.insert(loanTerms).values(values).onConflictDoUpdate({ target: loanTerms.accountId, set: changes });

    // The opening rate is the first period. Later changes add periods and never touch this one.
    const [firstPeriod] = await tx
      .select({ id: loanRatePeriods.id })
      .from(loanRatePeriods)
      .where(and(eq(loanRatePeriods.accountId, input.accountId), eq(loanRatePeriods.workspaceId, ws.workspaceId)))
      .orderBy(asc(loanRatePeriods.fromOn));
    const period = {
      id: firstPeriod?.id ?? uuidv7(),
      accountId: input.accountId,
      workspaceId: ws.workspaceId,
      fromOn: input.firstPaymentOn,
      rateBps: input.rateBps,
      kind: input.rateKind ?? ('fixed' as const),
      paymentMinor: input.paymentMinor ?? 0,
    };
    await tx.insert(loanRatePeriods).values(period).onConflictDoUpdate({ target: loanRatePeriods.id, set: period });
  });
}

/**
 * What a loan files as in Bagian B, changed on its own.
 *
 * Not `saveLoanTerms` with the same terms sent back: that rewrites the opening rate period from the terms, and
 * a period that began before the first instalment — a rate agreed at signing, a grace period — would be moved
 * to the first payment date by a change that was only ever about the code.
 */
export async function setLoanCode(database: Database, ws: WorkspaceContext, accountId: string, coretaxCode: string): Promise<void> {
  await database.transaction(async (tx) => {
    await loanAccountTx(tx, ws, accountId);
    const [existing] = await tx
      .select({ accountId: loanTerms.accountId })
      .from(loanTerms)
      .where(and(eq(loanTerms.accountId, accountId), eq(loanTerms.workspaceId, ws.workspaceId)));
    if (!existing) throw new LoanDbError("Add this loan's terms first, then file it under a code");
    await tx
      .update(loanTerms)
      .set({ coretaxCode })
      .where(and(eq(loanTerms.accountId, accountId), eq(loanTerms.workspaceId, ws.workspaceId)));
  });
}

/**
 * Which kind of loan a loan is, in the catalogue's own words: a home mortgage, a vehicle lease, a paylater.
 *
 * A row of its own and not a field of `saveLoanTerms`, for the same reason `setLoanCode` is: the terms form
 * sends back everything it holds, and a classification that travelled with it could be rewritten by a change
 * that was only ever about a tenor. Nothing here needs the terms — a loan opened from the Accounts page, with
 * no terms at all, still knows what kind of debt it is.
 *
 * `null` clears it, and the loan reads as what its own facts say again.
 */
export async function setLoanItem(database: Database, ws: WorkspaceContext, accountId: string, itemId: string | null): Promise<void> {
  if (itemId !== null) {
    const item = debtItem(itemId);
    if (item.behaviour.opens !== 'loan') throw new LoanDbError(`“${item.label}” is not a loan`);
  }
  await database.transaction(async (tx) => {
    await loanAccountTx(tx, ws, accountId);
    if (itemId === null) {
      await tx.delete(loanItems).where(and(eq(loanItems.accountId, accountId), eq(loanItems.workspaceId, ws.workspaceId)));
      return;
    }
    const row = { accountId, workspaceId: ws.workspaceId, itemId, createdAt: new Date().toISOString() };
    await tx.insert(loanItems).values(row).onConflictDoUpdate({ target: loanItems.accountId, set: { itemId } });
  });
}

/**
 * Which kind of loan every classified loan is, by account — one read for the whole list.
 *
 * Its own read rather than a field of `LoanTermsRow`, because a loan opened from the Accounts page has no terms
 * yet and still knows what kind of debt it is. A loan with no row here is unclassified, and reads as what its
 * own facts say.
 */
export async function listLoanItems(database: Database, ws: WorkspaceContext): Promise<Record<string, string>> {
  const rows = await database.db
    .select({ accountId: loanItems.accountId, itemId: loanItems.itemId })
    .from(loanItems)
    .where(eq(loanItems.workspaceId, ws.workspaceId));
  return Object.fromEntries(rows.map((row) => [row.accountId, row.itemId]));
}

type TermsDbRow = typeof loanTerms.$inferSelect;

function toRow(row: TermsDbRow, periods: RatePeriodRow[], isHomeLoan: boolean): LoanTermsRow {
  return {
    accountId: row.accountId,
    workspaceId: row.workspaceId,
    lenderName: row.lenderName,
    lenderNpwp: row.lenderNpwp,
    purpose: row.purpose,
    originalMinor: row.originalMinor,
    firstPaymentOn: row.firstPaymentOn,
    tenorMonths: row.tenorMonths,
    method: row.method,
    paymentDay: row.paymentDay,
    assetAccountId: row.assetAccountId,
    coretaxCode: row.coretaxCode,
    status: row.status,
    statusOn: row.statusOn,
    isHomeLoan,
    periods,
  };
}

/** Subtypes that make a loan a mortgage for the ratios. */
const HOME_SUBTYPES = ['property'];

async function loansWith(database: Database, ws: WorkspaceContext, accountId?: string): Promise<LoanTermsRow[]> {
  const where = accountId
    ? and(eq(loanTerms.workspaceId, ws.workspaceId), eq(loanTerms.accountId, accountId))
    : eq(loanTerms.workspaceId, ws.workspaceId);
  const rows = await database.db.select().from(loanTerms).where(where).orderBy(asc(loanTerms.createdAt));
  if (rows.length === 0) return [];

  const periods = await database.db
    .select()
    .from(loanRatePeriods)
    .where(eq(loanRatePeriods.workspaceId, ws.workspaceId))
    .orderBy(asc(loanRatePeriods.fromOn));
  const assetRows = await database.db
    .select({ id: accounts.id, subtype: accounts.subtype })
    .from(accounts)
    .where(eq(accounts.workspaceId, ws.workspaceId));
  const subtypeOf = new Map(assetRows.map((account) => [account.id, account.subtype]));

  return rows.map((row) =>
    toRow(
      row,
      periods
        .filter((period) => period.accountId === row.accountId)
        .map((period) => ({ id: period.id, accountId: period.accountId, fromOn: period.fromOn, rateBps: period.rateBps, kind: period.kind, paymentMinor: period.paymentMinor })),
      HOME_SUBTYPES.includes(subtypeOf.get(row.assetAccountId ?? '') ?? ''),
    ),
  );
}

export async function loanFor(database: Database, ws: WorkspaceContext, accountId: string): Promise<LoanTermsRow | undefined> {
  return (await loansWith(database, ws, accountId))[0];
}

export async function listLoans(database: Database, ws: WorkspaceContext): Promise<LoanTermsRow[]> {
  return loansWith(database, ws);
}

/** The loans that count as a mortgage, so `periodFlows` can keep them out of consumer debt. */
export async function homeLoanAccountIds(database: Database, ws: WorkspaceContext): Promise<string[]> {
  return (await loansWith(database, ws)).filter((loan) => loan.isHomeLoan).map((loan) => loan.accountId);
}

/** What is still owed on a loan by a date, as a positive amount. A loan is carried as a credit. */
async function owedOnTx(tx: Db, ws: WorkspaceContext, accountId: string, onDate?: string): Promise<number> {
  const rows = await tx
    .select({ amountMinor: entries.amountMinor, occurredOn: transactions.occurredOn })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(and(eq(entries.workspaceId, ws.workspaceId), eq(entries.accountId, accountId), eq(transactions.status, 'posted')));
  return -rows.filter((row) => (onDate ? row.occurredOn <= onDate : true)).reduce((total, row) => total + row.amountMinor, 0);
}

async function accountNameTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<string> {
  const [row] = await tx
    .select({ name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  return row?.name ?? 'this loan';
}

/** The terms and rate periods a schedule needs, in the shapes core expects. */
async function termsForTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<{ terms: LoanTerms; periods: RatePeriod[]; row: TermsDbRow }> {
  const [row] = await tx
    .select()
    .from(loanTerms)
    .where(and(eq(loanTerms.accountId, accountId), eq(loanTerms.workspaceId, ws.workspaceId)));
  if (!row) throw new LoanDbError('Add this loan\'s terms first, then record against it');
  const periodRows = await tx
    .select()
    .from(loanRatePeriods)
    .where(and(eq(loanRatePeriods.accountId, accountId), eq(loanRatePeriods.workspaceId, ws.workspaceId)))
    .orderBy(asc(loanRatePeriods.fromOn));
  return {
    row,
    terms: {
      originalMinor: row.originalMinor,
      firstPaymentOn: row.firstPaymentOn,
      tenorMonths: row.tenorMonths,
      method: row.method,
      paymentDay: row.paymentDay,
    },
    periods: periodRows.map((period) => ({ fromOn: period.fromOn, rateBps: period.rateBps, kind: period.kind, paymentMinor: period.paymentMinor })),
  };
}

export interface LoanPaymentInput {
  accountId: string;
  occurredOn: string;
  moneyAccountId: string;
  principalMinor: number;
  interestMinor: number;
  /** Admin charges or insurance riding on the same payment, by category. */
  extras?: { categoryId: string; amountMinor: number }[];
  ratesToBase?: Record<string, number>;
  /** Which goal the money came out of, when it took more than was free (spec §4.4). */
  setAside?: SetAsideChoice | null;
}

export interface AddRatePeriodInput {
  accountId: string;
  fromOn: string;
  rateBps: number;
  kind: 'fixed' | 'floating';
  paymentMinor?: number;
}

export interface ExtraPaymentDbInput {
  accountId: string;
  occurredOn: string;
  moneyAccountId: string;
  amountMinor: number;
  penaltyMinor?: number;
  /** Shorten the tenor and keep paying the same, or keep the tenor and lower the payment. */
  keep: 'payment' | 'tenor';
  ratesToBase?: Record<string, number>;
  /** Which goal the money came out of, when it took more than was free (spec §4.4). */
  setAside?: SetAsideChoice | null;
}

const line = (accountId: string, amountMinor: number, currency: string): PostingLine => ({ accountId, amountMinor, currency });

/**
 * Posts one instalment: the bank account is lighter, the loan falls by the principal, and the
 * interest is spending. A payment that clears the balance marks the loan paid off.
 */
export async function recordLoanPayment(
  database: Database,
  ws: WorkspaceContext,
  input: LoanPaymentInput,
): Promise<{ transactionId: string; balanceMinor: number; status: 'open' | 'paid_off' }> {
  if (input.principalMinor < 0 || input.interestMinor < 0) throw new LoanDbError('A payment cannot be negative');
  if (input.principalMinor + input.interestMinor <= 0) throw new LoanDbError('Enter what was paid');

  return database.transaction(async (tx) => {
    const { currency } = await loanAccountTx(tx, ws, input.accountId);
    const name = await accountNameTx(tx, ws, input.accountId);
    const owed = await owedOnTx(tx, ws, input.accountId);
    if (input.principalMinor > owed) throw new LoanDbError(`${name} has ${owed} left, so the principal cannot be more than that`);
    // Interest, fees: the open workspace's copies, since the payment is recorded there.
    const keys = await categoryIdsByKeyTx(tx, ws);
    const extras = (input.extras ?? []).filter((extra) => extra.amountMinor > 0);
    const total = input.principalMinor + input.interestMinor + extras.reduce((sum, extra) => sum + extra.amountMinor, 0);

    const lines: PostingLine[] = [line(input.accountId, input.principalMinor, currency)];
    if (input.interestMinor > 0) lines.push(line(keys['miscellaneous.interest']!, input.interestMinor, currency));
    for (const extra of extras) lines.push(line(extra.categoryId, extra.amountMinor, currency));
    lines.push(line(input.moneyAccountId, -total, currency));

    const transactionId = await postTransactionTx(tx, ws, {
      occurredOn: input.occurredOn,
      description: `Instalment: ${name}`,
      lines,
      ratesToBase: input.ratesToBase,
      setAside: input.setAside,
    });

    const balanceMinor = owed - input.principalMinor;
    const status = balanceMinor <= 0 ? ('paid_off' as const) : ('open' as const);
    if (status === 'paid_off') {
      await tx
        .update(loanTerms)
        .set({ status, statusOn: input.occurredOn })
        .where(and(eq(loanTerms.accountId, input.accountId), eq(loanTerms.workspaceId, ws.workspaceId)));
    }
    return { transactionId, balanceMinor, status };
  });
}

/** A rate change writes a period and posts nothing: no money moved. */
export async function addRatePeriod(database: Database, ws: WorkspaceContext, input: AddRatePeriodInput): Promise<string> {
  return database.transaction(async (tx) => {
    await loanAccountTx(tx, ws, input.accountId);
    await termsForTx(tx, ws, input.accountId);
    const id = uuidv7();
    await tx.insert(loanRatePeriods).values({
      id,
      accountId: input.accountId,
      workspaceId: ws.workspaceId,
      fromOn: input.fromOn,
      rateBps: input.rateBps,
      kind: input.kind,
      paymentMinor: input.paymentMinor ?? 0,
    });
    return id;
  });
}

/**
 * Extra principal, on top of the instalments. Keeping the payment finishes the loan sooner and
 * writes no period; keeping the tenor writes one carrying the lower payment the bank will now ask for.
 */
export async function recordExtraPayment(
  database: Database,
  ws: WorkspaceContext,
  input: ExtraPaymentDbInput,
): Promise<{ transactionId: string; balanceMinor: number; newPaymentMinor: number | null }> {
  if (!(input.amountMinor > 0)) throw new LoanDbError('Enter how much extra was paid');

  return database.transaction(async (tx) => {
    const { currency } = await loanAccountTx(tx, ws, input.accountId);
    const name = await accountNameTx(tx, ws, input.accountId);
    const owed = await owedOnTx(tx, ws, input.accountId);
    if (input.amountMinor > owed) throw new LoanDbError(`${name} has ${owed} left, so nothing more than that can be paid off`);
    const { terms, periods } = await termsForTx(tx, ws, input.accountId);
    // Interest, fees: the open workspace's copies, since the payment is recorded there.
    const keys = await categoryIdsByKeyTx(tx, ws);
    const penaltyMinor = input.penaltyMinor ?? 0;

    const lines: PostingLine[] = [line(input.accountId, input.amountMinor, currency)];
    // A penalty is what the bank charges for paying early: a fee, never part of the principal.
    if (penaltyMinor > 0) lines.push(line(keys['miscellaneous.fees_charges']!, penaltyMinor, currency));
    lines.push(line(input.moneyAccountId, -(input.amountMinor + penaltyMinor), currency));

    const transactionId = await postTransactionTx(tx, ws, {
      occurredOn: input.occurredOn,
      description: `Extra payment: ${name}`,
      lines,
      ratesToBase: input.ratesToBase,
      setAside: input.setAside,
    });

    let newPaymentMinor: number | null = null;
    if (input.keep === 'tenor') {
      const effect = extraPaymentEffect(owed, terms, periods, input.occurredOn, {
        amountMinor: input.amountMinor,
        onDate: input.occurredOn,
        repeat: 'once',
        keep: 'tenor',
      });
      newPaymentMinor = effect.newPaymentMinor;
      if (newPaymentMinor !== null) {
        const rateBps = periodOn(periods, input.occurredOn)?.rateBps ?? 0;
        await tx.insert(loanRatePeriods).values({
          id: uuidv7(),
          accountId: input.accountId,
          workspaceId: ws.workspaceId,
          fromOn: input.occurredOn,
          rateBps,
          kind: 'fixed',
          paymentMinor: newPaymentMinor,
        });
      }
    }
    return { transactionId, balanceMinor: owed - input.amountMinor, newPaymentMinor };
  });
}

/** The payments still to come, worked out from the balance the ledger holds on that date. */
export async function scheduleFor(database: Database, ws: WorkspaceContext, accountId: string, fromDate: string): Promise<ScheduleRow[]> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select({ accountId: loanTerms.accountId })
      .from(loanTerms)
      .where(and(eq(loanTerms.accountId, accountId), eq(loanTerms.workspaceId, ws.workspaceId)));
    if (!row) return [];
    const { terms, periods } = await termsForTx(tx, ws, accountId);
    const owed = await owedOnTx(tx, ws, accountId, fromDate);
    return loanSchedule(owed, terms, periods, fromDate);
  });
}

/** The row the payment form fills itself in from. */
export async function nextPaymentDue(database: Database, ws: WorkspaceContext, accountId: string, fromDate: string): Promise<ScheduleRow | undefined> {
  return (await scheduleFor(database, ws, accountId, fromDate))[0];
}

/** What one loan asks next, and when it ends — the facts a list prints for it instead of its principal. */
export interface LoanAsk {
  accountId: string;
  /** The instalment due next, or the figure the bank named when nothing is left to schedule. */
  paymentMinor: number;
  /** The month of the last payment, `2027-08`. Null when nothing is scheduled. */
  paysOffOn: string | null;
}

/**
 * What every loan asks next, by account: its instalment, and when the debt ends.
 *
 * One schedule per loan, the same read the loan's own page makes — which is why a loan with nothing left to
 * schedule still answers with the figure the bank named rather than a nought.
 */
export async function scheduledAsks(database: Database, ws: WorkspaceContext, fromDate: string): Promise<Record<string, LoanAsk>> {
  const loans = await loansWith(database, ws);
  const asks: Record<string, LoanAsk> = {};
  for (const loan of loans) {
    const rows = await scheduleFor(database, ws, loan.accountId, fromDate);
    const last = rows.at(-1);
    asks[loan.accountId] = {
      accountId: loan.accountId,
      paymentMinor: rows[0]?.paymentMinor ?? periodOn(loan.periods, fromDate)?.paymentMinor ?? 0,
      paysOffOn: last ? last.onDate.slice(0, 7) : null,
    };
  }
  return asks;
}

/**
 * What each loan is due to pay next, by account — the instalment, worked out from the balance the ledger
 * holds, exactly as the detail screen and the attention rows already do.
 *
 * `periods[].paymentMinor` is *the payment the bank named, when it named one*: the form invites you to leave
 * it blank and 0 is stored. A list that reads it directly prints `Rp 0` for a loan onboarded that way, which
 * is what `/net-worth/loans` did. `loanSchedule` already prefers the bank's own figure while it stands, so
 * this is the one reading that is right either way. A loan with nothing left owing falls back to the figure
 * the bank named, so a screen never shows less than what is known.
 */
export async function scheduledPayments(database: Database, ws: WorkspaceContext, fromDate: string): Promise<Record<string, number>> {
  const asks = await scheduledAsks(database, ws, fromDate);
  return Object.fromEntries(Object.entries(asks).map(([accountId, ask]) => [accountId, ask.paymentMinor]));
}
