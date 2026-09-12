import { type LoanMethod, uuidv7 } from '@expanses/core';
import { and, asc, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { loanRatePeriods, loanTerms } from '../schema-loans';

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
