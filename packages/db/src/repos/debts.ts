import {
  borrowPostings,
  type DebtDirection,
  type DebtStatus,
  debtDescription,
  forgivePostings,
  lendPostings,
  type PostingLine,
  repayBorrowedPostings,
  repaymentPostings,
  splitBillPostings,
  statusFor,
} from '@expanses/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries, transactions } from '../schema';
import { debtProfiles } from '../schema-debts';
import { createAccountTx } from './accounts';
import { categoryIdsByKeyTx } from './categories';
import { postTransactionTx } from './ledger';

export class DebtDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DebtDbError';
  }
}

/** Money lent sits in a receivable; money borrowed sits in a payable. Nothing else may carry a person. */
const DIRECTION_BY_SUBTYPE: Record<string, DebtDirection> = { receivable: 'lent', payable: 'borrowed' };

/** What the Coretax tables call each side when no related-party code is chosen. */
/** A receivable carries a kode harta; a payable's code is the unverified e-Form one. */
export const DEFAULT_CORETAX_CODE: Record<DebtDirection, string> = { lent: '0201', borrowed: '104' };

export interface DebtProfileRow {
  accountId: string;
  workspaceId: string;
  /** Read from the account, so it can never drift from where the balance sits. */
  direction: DebtDirection;
  personName: string;
  personIdNumber: string | null;
  reason: string | null;
  dueOn: string | null;
  status: DebtStatus;
  statusOn: string | null;
  coretaxCode: string;
  createdAt: string;
}

export interface SaveDebtProfileInput {
  accountId: string;
  personName: string;
  personIdNumber?: string | null;
  reason?: string | null;
  dueOn?: string | null;
  coretaxCode?: string;
}

/** The account a person's debt lives on, with the direction it implies. */
export async function debtAccountTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<{ subtype: string; currency: string; direction: DebtDirection }> {
  const [row] = await tx
    .select({ subtype: accounts.subtype, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!row) throw new DebtDbError('Account not found in this workspace');
  const direction = DIRECTION_BY_SUBTYPE[row.subtype];
  if (!direction) throw new DebtDbError('Only an account lent to or borrowed from a person can carry a debt');
  return { subtype: row.subtype, currency: row.currency ?? ws.baseCurrency, direction };
}

const toRow = (row: typeof debtProfiles.$inferSelect, direction: DebtDirection): DebtProfileRow => ({
  accountId: row.accountId,
  workspaceId: row.workspaceId,
  direction,
  personName: row.personName,
  personIdNumber: row.personIdNumber,
  reason: row.reason,
  dueOn: row.dueOn,
  status: row.status,
  statusOn: row.statusOn,
  coretaxCode: row.coretaxCode,
  createdAt: row.createdAt,
});

/** Adds or updates who a debt is with, and why. The balance itself stays in the ledger. */
export async function saveDebtProfile(database: Database, ws: WorkspaceContext, input: SaveDebtProfileInput): Promise<void> {
  const personName = input.personName.trim();
  if (!personName) throw new DebtDbError('A debt needs a name to go with it');

  await database.transaction(async (tx) => {
    const { direction } = await debtAccountTx(tx, ws, input.accountId);
    const [existing] = await tx
      .select({ accountId: debtProfiles.accountId, status: debtProfiles.status, statusOn: debtProfiles.statusOn, createdAt: debtProfiles.createdAt })
      .from(debtProfiles)
      .where(and(eq(debtProfiles.accountId, input.accountId), eq(debtProfiles.workspaceId, ws.workspaceId)));

    const values = {
      accountId: input.accountId,
      workspaceId: ws.workspaceId,
      personName,
      personIdNumber: input.personIdNumber ?? null,
      reason: input.reason ?? null,
      dueOn: input.dueOn ?? null,
      status: existing?.status ?? ('open' as DebtStatus),
      statusOn: existing?.statusOn ?? null,
      coretaxCode: input.coretaxCode ?? DEFAULT_CORETAX_CODE[direction],
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const { createdAt, ...changes } = values;
    await tx.insert(debtProfiles).values(values).onConflictDoUpdate({ target: debtProfiles.accountId, set: changes });
  });
}

export async function getDebtProfile(database: Database, ws: WorkspaceContext, accountId: string): Promise<DebtProfileRow | undefined> {
  const [row] = await database.db
    .select()
    .from(debtProfiles)
    .where(and(eq(debtProfiles.accountId, accountId), eq(debtProfiles.workspaceId, ws.workspaceId)));
  if (!row) return undefined;
  const [account] = await database.db
    .select({ subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  const direction = DIRECTION_BY_SUBTYPE[account?.subtype ?? ''] ?? 'lent';
  return toRow(row, direction);
}

export async function listDebtProfiles(database: Database, ws: WorkspaceContext): Promise<DebtProfileRow[]> {
  const rows = await database.db
    .select()
    .from(debtProfiles)
    .where(eq(debtProfiles.workspaceId, ws.workspaceId))
    .orderBy(asc(debtProfiles.personName), asc(debtProfiles.createdAt));
  if (rows.length === 0) return [];
  const accountRows = await database.db
    .select({ id: accounts.id, subtype: accounts.subtype })
    .from(accounts)
    .where(eq(accounts.workspaceId, ws.workspaceId));
  const subtypeOf = new Map(accountRows.map((account) => [account.id, account.subtype]));
  return rows.map((row) => toRow(row, DIRECTION_BY_SUBTYPE[subtypeOf.get(row.accountId) ?? ''] ?? 'lent'));
}

/** What the person owes right now, as a positive amount whichever way the debt runs. */
async function owedNowTx(tx: Db, ws: WorkspaceContext, accountId: string, direction: DebtDirection): Promise<number> {
  const rows = await tx
    .select({ amountMinor: entries.amountMinor })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(and(eq(entries.workspaceId, ws.workspaceId), eq(entries.accountId, accountId), eq(transactions.status, 'posted')));
  const raw = rows.reduce((total, row) => total + row.amountMinor, 0);
  // A receivable is a debit balance; a payable is a credit one.
  return direction === 'lent' ? raw : -raw;
}

/** The categories every debt action can reach for. */
async function debtCategoriesTx(tx: Db, ws: WorkspaceContext) {
  const keys = await categoryIdsByKeyTx(tx, ws);
  return {
    otherIncomeAccountId: keys['income.other']!,
    interestAccountId: keys['fees.interest']!,
    forgivenessAccountId: keys['gifts_donations']!,
  };
}

async function writeProfileTx(
  tx: Db,
  ws: WorkspaceContext,
  input: { accountId: string; personName: string; personIdNumber?: string | null; reason?: string | null; dueOn?: string | null; coretaxCode?: string },
  direction: DebtDirection,
): Promise<void> {
  const values = {
    accountId: input.accountId,
    workspaceId: ws.workspaceId,
    personName: input.personName.trim(),
    personIdNumber: input.personIdNumber ?? null,
    reason: input.reason ?? null,
    dueOn: input.dueOn ?? null,
    status: 'open' as DebtStatus,
    statusOn: null as string | null,
    coretaxCode: input.coretaxCode ?? DEFAULT_CORETAX_CODE[direction],
    createdAt: new Date().toISOString(),
  };
  await tx.insert(debtProfiles).values(values);
}

async function setStatusTx(tx: Db, ws: WorkspaceContext, accountId: string, status: DebtStatus, statusOn: string | null): Promise<void> {
  await tx
    .update(debtProfiles)
    .set({ status, statusOn })
    .where(and(eq(debtProfiles.accountId, accountId), eq(debtProfiles.workspaceId, ws.workspaceId)));
}

/** Opens the account for a person the workspace has not met yet, with their profile beside it. */
async function openPersonTx(
  tx: Db,
  ws: WorkspaceContext,
  person: { name: string; direction: DebtDirection; currency: string; personIdNumber?: string | null; reason?: string | null; dueOn?: string | null },
): Promise<string> {
  const name = person.name.trim();
  if (!name) throw new DebtDbError('A debt needs a name to go with it');
  const account = await createAccountTx(tx, ws, {
    name,
    kind: person.direction === 'lent' ? 'asset' : 'liability',
    subtype: person.direction === 'lent' ? 'receivable' : 'payable',
    currency: person.currency,
  });
  await writeProfileTx(tx, ws, { accountId: account.id, personName: name, personIdNumber: person.personIdNumber, reason: person.reason, dueOn: person.dueOn }, person.direction);
  return account.id;
}

export interface RecordLoanInput {
  /** An account this person already has, or `person` to open one. */
  debtAccountId?: string;
  person?: { name: string; direction: DebtDirection; currency: string; personIdNumber?: string | null; reason?: string | null; dueOn?: string | null };
  occurredOn: string;
  amountMinor: number;
  moneyAccountId: string;
  /** Card purchases only: the category the loan would have had, so the points still count. */
  spendCategoryId?: string | null;
  mcc?: string | null;
  ratesToBase?: Record<string, number>;
}

export interface RecordRepaymentInput {
  debtAccountId: string;
  occurredOn: string;
  amountMinor: number;
  interestMinor?: number;
  moneyAccountId: string;
  ratesToBase?: Record<string, number>;
}

export interface ForgiveInput {
  debtAccountId: string;
  occurredOn: string;
  /** Where the written-off amount goes. Gifts & Donations by default. */
  categoryId?: string | null;
}

export interface SplitBillInput {
  occurredOn: string;
  description: string;
  totalMinor: number;
  moneyAccountId: string;
  ownCategoryId: string;
  ownShareMinor: number;
  shares: { debtAccountId?: string; person?: { name: string; currency: string }; amountMinor: number }[];
  spendCategoryId?: string | null;
  mcc?: string | null;
  ratesToBase?: Record<string, number>;
}

/** Money handed to a person, from a bank account or on a card. */
export async function recordLoan(database: Database, ws: WorkspaceContext, input: RecordLoanInput): Promise<{ transactionId: string; debtAccountId: string }> {
  return database.transaction(async (tx) => {
    const debtAccountId = input.debtAccountId ?? (input.person ? await openPersonTx(tx, ws, input.person) : null);
    if (!debtAccountId) throw new DebtDbError('Say who this debt is with');
    const { direction, currency } = await debtAccountTx(tx, ws, debtAccountId);
    const categories = await debtCategoriesTx(tx, ws);
    const accountsForPostings = { debtAccountId, moneyAccountId: input.moneyAccountId, ...categories };
    const amount = { amountMinor: input.amountMinor, currency };

    const lines = (direction === 'lent' ? lendPostings(amount, accountsForPostings) : borrowPostings(amount, accountsForPostings)).map((line) =>
      // The card line names the category it would have had, so points are counted without it being spending.
      input.spendCategoryId && line.accountId === input.moneyAccountId ? { ...line, spendCategoryId: input.spendCategoryId } : line,
    );
    const profile = await tx
      .select({ personName: debtProfiles.personName, status: debtProfiles.status })
      .from(debtProfiles)
      .where(and(eq(debtProfiles.accountId, debtAccountId), eq(debtProfiles.workspaceId, ws.workspaceId)));
    const personName = profile[0]?.personName ?? 'someone';

    const transactionId = await postTransactionTx(tx, ws, {
      occurredOn: input.occurredOn,
      description: debtDescription(direction === 'lent' ? 'lend' : 'borrow', personName),
      lines,
      ratesToBase: input.ratesToBase,
      mcc: input.mcc ?? null,
    });
    // Lending again to someone who had paid everything back puts them back on the open list.
    if (profile[0]?.status === 'settled') await setStatusTx(tx, ws, debtAccountId, 'open', null);
    return { transactionId, debtAccountId };
  });
}

/** Money coming back, with interest kept apart from the principal. Settles the debt when nothing is left. */
export async function recordRepayment(
  database: Database,
  ws: WorkspaceContext,
  input: RecordRepaymentInput,
): Promise<{ transactionId: string; balanceMinor: number; status: DebtStatus }> {
  return database.transaction(async (tx) => {
    const { direction, currency } = await debtAccountTx(tx, ws, input.debtAccountId);
    const [profile] = await tx
      .select({ personName: debtProfiles.personName, status: debtProfiles.status })
      .from(debtProfiles)
      .where(and(eq(debtProfiles.accountId, input.debtAccountId), eq(debtProfiles.workspaceId, ws.workspaceId)));
    if (!profile) throw new DebtDbError('That account is not a debt with anyone yet');
    const owed = await owedNowTx(tx, ws, input.debtAccountId, direction);
    const categories = await debtCategoriesTx(tx, ws);
    const accountsForPostings = { debtAccountId: input.debtAccountId, moneyAccountId: input.moneyAccountId, ...categories };
    const amount = {
      amountMinor: input.amountMinor,
      interestMinor: input.interestMinor ?? 0,
      currency,
      balanceMinor: owed,
      personName: profile.personName,
    };

    const lines = direction === 'lent' ? repaymentPostings(amount, accountsForPostings) : repayBorrowedPostings(amount, accountsForPostings);
    const transactionId = await postTransactionTx(tx, ws, {
      occurredOn: input.occurredOn,
      description: debtDescription(direction === 'lent' ? 'repayment' : 'repay', profile.personName),
      lines,
      ratesToBase: input.ratesToBase,
    });

    const balanceMinor = owed - input.amountMinor;
    const status = statusFor(balanceMinor, profile.status);
    if (status !== profile.status) await setStatusTx(tx, ws, input.debtAccountId, status, input.occurredOn);
    return { transactionId, balanceMinor, status };
  });
}

/** Writes off what is left as a gift, and marks the debt forgiven for good. */
export async function forgiveRemainder(database: Database, ws: WorkspaceContext, input: ForgiveInput): Promise<{ transactionId: string }> {
  return database.transaction(async (tx) => {
    const { direction, currency } = await debtAccountTx(tx, ws, input.debtAccountId);
    const [profile] = await tx
      .select({ personName: debtProfiles.personName })
      .from(debtProfiles)
      .where(and(eq(debtProfiles.accountId, input.debtAccountId), eq(debtProfiles.workspaceId, ws.workspaceId)));
    if (!profile) throw new DebtDbError('That account is not a debt with anyone yet');
    const owed = await owedNowTx(tx, ws, input.debtAccountId, direction);
    const categories = await debtCategoriesTx(tx, ws);

    const lines = forgivePostings(
      { balanceMinor: owed, currency },
      { debtAccountId: input.debtAccountId, moneyAccountId: input.debtAccountId, ...categories, forgivenessAccountId: input.categoryId ?? categories.forgivenessAccountId },
    );
    const transactionId = await postTransactionTx(tx, ws, {
      occurredOn: input.occurredOn,
      description: debtDescription('forgive', profile.personName),
      lines,
      ratesToBase: {},
    });
    await setStatusTx(tx, ws, input.debtAccountId, 'forgiven', input.occurredOn);
    return { transactionId };
  });
}

/** A bill one account paid in full, where the others owe their share. */
export async function splitBill(database: Database, ws: WorkspaceContext, input: SplitBillInput): Promise<{ transactionId: string; debtAccountIds: string[] }> {
  return database.transaction(async (tx) => {
    const [money] = await tx
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.id, input.moneyAccountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!money) throw new DebtDbError('Account not found in this workspace');
    const currency = money.currency ?? ws.baseCurrency;

    const debtAccountIds: string[] = [];
    for (const share of input.shares) {
      const accountId = share.debtAccountId ?? (share.person ? await openPersonTx(tx, ws, { ...share.person, direction: 'lent' }) : null);
      if (!accountId) throw new DebtDbError('Say who owes each share');
      debtAccountIds.push(accountId);
    }

    const lines: PostingLine[] = splitBillPostings(
      {
        totalMinor: input.totalMinor,
        ownCategoryId: input.ownCategoryId,
        ownShareMinor: input.ownShareMinor,
        shares: debtAccountIds.map((debtAccountId, index) => ({ debtAccountId, amountMinor: input.shares[index]!.amountMinor })),
        currency,
      },
      { moneyAccountId: input.moneyAccountId },
    )
      // A bill with no share of your own still balances; the empty category line is dropped.
      .filter((line) => line.amountMinor !== 0)
      .map((line) => (input.spendCategoryId && line.accountId === input.moneyAccountId ? { ...line, spendCategoryId: input.spendCategoryId } : line));

    const transactionId = await postTransactionTx(tx, ws, {
      occurredOn: input.occurredOn,
      description: input.description,
      lines,
      ratesToBase: input.ratesToBase,
      mcc: input.mcc ?? null,
    });
    return { transactionId, debtAccountIds };
  });
}
