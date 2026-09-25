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
import type { SetAsideChoice } from './set-aside-tx';

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
export const DEFAULT_CORETAX_CODE: Record<DebtDirection, string> = { lent: '0201', borrowed: '109' };

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

/** The categories every debt action can reach for — the open workspace's copies, since that is where it records. */
async function debtCategoriesTx(tx: Db, ws: WorkspaceContext) {
  const keys = await categoryIdsByKeyTx(tx, ws);
  return {
    otherIncomeAccountId: keys['income.other']!,
    interestAccountId: keys['miscellaneous.interest']!,
    forgivenessAccountId: keys['gift_giving']!,
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
  person: { name: string; direction: DebtDirection; currency: string; personIdNumber?: string | null; reason?: string | null; dueOn?: string | null; coretaxCode?: string },
): Promise<string> {
  const name = person.name.trim();
  if (!name) throw new DebtDbError('A debt needs a name to go with it');
  const account = await createAccountTx(tx, ws, {
    name,
    kind: person.direction === 'lent' ? 'asset' : 'liability',
    subtype: person.direction === 'lent' ? 'receivable' : 'payable',
    currency: person.currency,
  });
  await writeProfileTx(
    tx,
    ws,
    { accountId: account.id, personName: name, personIdNumber: person.personIdNumber, reason: person.reason, dueOn: person.dueOn, coretaxCode: person.coretaxCode },
    person.direction,
  );
  return account.id;
}

export interface OpenDebtBalanceInput {
  direction: DebtDirection;
  personName: string;
  currency: string;
  /** What is owed now, as a positive amount whichever way the debt runs. */
  balanceMinor: number;
  openedOn?: string;
  personIdNumber?: string | null;
  reason?: string | null;
  dueOn?: string | null;
  coretaxCode?: string;
  openingRateToBase?: number;
}

/**
 * A debt or a receivable that already existed, opened at what is owed today. `recordLoan` is for money
 * moving now and needs an account to move it from; this one posts against Opening Balances, the way
 * every other balance brought in from before the app does.
 */
export async function openDebtBalance(database: Database, ws: WorkspaceContext, input: OpenDebtBalanceInput): Promise<{ id: string }> {
  const personName = input.personName.trim();
  if (!personName) throw new DebtDbError('A debt needs a name to go with it');
  if (input.balanceMinor < 0) throw new DebtDbError('Say what is owed as a positive amount');
  return database.transaction(async (tx) => {
    const account = await createAccountTx(tx, ws, {
      name: personName,
      kind: input.direction === 'lent' ? 'asset' : 'liability',
      subtype: input.direction === 'lent' ? 'receivable' : 'payable',
      currency: input.currency,
      // Natural sign: openingBalanceLines already turns a liability's amount owed the right way round.
      openingBalanceMinor: input.balanceMinor,
      openedOn: input.openedOn,
      openingRateToBase: input.openingRateToBase,
    });
    await writeProfileTx(
      tx,
      ws,
      {
        accountId: account.id,
        personName,
        personIdNumber: input.personIdNumber,
        reason: input.reason,
        dueOn: input.dueOn,
        coretaxCode: input.coretaxCode,
      },
      input.direction,
    );
    return { id: account.id };
  });
}

export interface RecordLoanInput {
  /** An account this person already has, or `person` to open one. */
  debtAccountId?: string;
  person?: { name: string; direction: DebtDirection; currency: string; personIdNumber?: string | null; reason?: string | null; dueOn?: string | null };
  /**
   * What the debt files as: the piutang code for money owed to you, the utang code for money you owe. Chosen here as
   * well as on the person's card, because the sub-category is worth asking at the moment the money moves — and it is
   * the person's profile that keeps it, so a loan added to somebody already on the list sets theirs too.
   */
  coretaxCode?: string;
  occurredOn: string;
  amountMinor: number;
  moneyAccountId: string;
  /** Card purchases only: the category the loan would have had, so the points still count. */
  spendCategoryId?: string | null;
  mcc?: string | null;
  ratesToBase?: Record<string, number>;
  /** Which goal the money came out of, when it took more than was free (spec §4.4). */
  setAside?: SetAsideChoice | null;
}

export interface RecordRepaymentInput {
  debtAccountId: string;
  occurredOn: string;
  amountMinor: number;
  interestMinor?: number;
  moneyAccountId: string;
  ratesToBase?: Record<string, number>;
  /** Which goal the money came out of, when it took more than was free (spec §4.4). */
  setAside?: SetAsideChoice | null;
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
  /**
   * The card the bill was paid on, when the account carries more than one — the same fact `PostTransactionInput`
   * carries under the same name. Sharing a restaurant bill cannot be what loses which card earned the points for
   * it: without this the row prints no digits and the receipt's "Paid with" names the bare account.
   */
  cardId?: string | null;
  /**
   * What the bill was in before the account converted it, when the two differ. Both or neither, exactly as on a
   * bill nobody else was at: a US$100 dinner split with a friend is still a US$100 dinner.
   */
  originalCurrency?: string | null;
  originalAmountMinor?: number | null;
  ratesToBase?: Record<string, number>;
  /** Online or offline, when the user said; null when they did not. Never guessed. */
  channel?: 'online' | 'offline' | null;
  /** Leaves the chart, the budgets and the category totals; balances, statements, points and net worth keep it. */
  excludedFromReport?: boolean;
  /** The event this belongs to. */
  eventId?: string | null;
  /** Photo rows written before the transaction had an id. A receipt is kept whoever else was at the table. */
  photoIds?: string[];
  /** Which goal the money came out of, when it took more than was free (spec §4.4). */
  setAside?: SetAsideChoice | null;
}

/** Money handed to a person, from a bank account or on a card. */
export async function recordLoan(database: Database, ws: WorkspaceContext, input: RecordLoanInput): Promise<{ transactionId: string; debtAccountId: string }> {
  return database.transaction(async (tx) => {
    const debtAccountId = input.debtAccountId ?? (input.person ? await openPersonTx(tx, ws, { ...input.person, coretaxCode: input.coretaxCode }) : null);
    if (!debtAccountId) throw new DebtDbError('Say who this debt is with');
    // A loan added to somebody already on the list still says what it is: the code is the person's, and this is where
    // it is chosen when the money moves rather than months later from their card.
    if (input.coretaxCode) {
      await tx
        .update(debtProfiles)
        .set({ coretaxCode: input.coretaxCode })
        .where(and(eq(debtProfiles.accountId, debtAccountId), eq(debtProfiles.workspaceId, ws.workspaceId)));
    }
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
      setAside: input.setAside,
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
      setAside: input.setAside,
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
      cardId: input.cardId ?? null,
      originalCurrency: input.originalCurrency ?? null,
      originalAmountMinor: input.originalAmountMinor ?? null,
      channel: input.channel,
      excludedFromReport: input.excludedFromReport,
      eventId: input.eventId,
      photoIds: input.photoIds,
      setAside: input.setAside,
    });
    return { transactionId, debtAccountIds };
  });
}
