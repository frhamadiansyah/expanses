import { type AccountKind, currencyInfo, openingBalanceLines, uuidv7 } from '@expanses/core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, auditLog, entries, transactions } from '../schema';
import { bookCategories } from '../schema-books';
import { SYSTEM_ACCOUNTS, type SystemAccountKey } from '../seed';
import { hasBooks, personalBookIdTx } from './books';
import { postTransactionTx } from './ledger';

export type AccountRow = typeof accounts.$inferSelect;
export type AccountSubtype = AccountRow['subtype'];

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountError';
  }
}

export const BALANCE_SUBTYPES = {
  asset: ['cash', 'bank', 'savings', 'fund', 'ewallet', 'time_deposit', 'other_cash', 'investment', 'property', 'vehicle', 'receivable'],
  liability: ['credit_card', 'loan', 'payable'],
} as const satisfies Record<'asset' | 'liability', readonly AccountSubtype[]>;

/**
 * Accounts money can be **paid from**: everyday cash, a wallet, a current or savings account. A transaction, a
 * bill, a card and an instalment are all paid out of one of these.
 *
 * A broker's cash is deliberately not here. An RDN cannot be spent from — the money is moved to a current or
 * savings account first — so it is not offered behind "Paid with", nor as the account a card or a loan is paid
 * from. It is money all the same: see `MONEY_SUBTYPES`, which is this list plus a broker's cash, and which the
 * three questions that really mean "money the ledger can move" ask instead.
 *
 * A time deposit is in neither list: it holds money it cannot be paid from, and the money leaves by a transfer
 * when it matures. Other cash equivalents — a cheque, a wesel, commercial paper — can be spent.
 */
export const SPENDABLE_SUBTYPES: readonly AccountSubtype[] = ['cash', 'bank', 'savings', 'ewallet', 'other_cash'];

/**
 * Money the ledger can move that nobody can spend: cash at a broker, which a buy is paid from and which is moved out
 * to a bank before it is spent from.
 *
 * Asked by exactly two questions — the cash side of a trade, and where a goal's money may wait — and by nothing else:
 * a deposit's opening balance cannot come from here and its payout cannot land here, so the deposit's own checks ask
 * `SPENDABLE_SUBTYPES` instead.
 */
export const MONEY_SUBTYPES: readonly AccountSubtype[] = [...SPENDABLE_SUBTYPES, 'fund'];

/** A pocket's stored name: the bank and the currency, so every list that prints a name already says both. */
export const pocketName = (parentName: string, currency: string) => `${parentName} · ${currency}`;

/**
 * The accounts that are pocket parents: every asset account some asset account names in `parent_id`, archived pockets
 * included. Categories use `parent_id` too, but they are income or expense, so they never count here.
 */
export function pocketParentIds(rows: readonly Pick<AccountRow, 'id' | 'parentId' | 'kind'>[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) if (row.kind === 'asset' && row.parentId) ids.add(row.parentId);
  return ids;
}

/** A money account under a parent is a pocket; these are the rules for one (spec §3.4). */
async function checkPocketTx(tx: Db, ws: WorkspaceContext, pocket: AccountRow, parent: AccountRow): Promise<void> {
  if (pocket.kind !== 'asset') throw new AccountError('Only a money account holds pockets');
  if (parent.parentId !== null) throw new AccountError('A pocket cannot hold pockets of its own');
  if (parent.archivedAt !== null) throw new AccountError(`${parent.name} is archived`);
  if (parent.subtype !== pocket.subtype) throw new AccountError(`A pocket is the same kind of account as ${parent.name}`);
  // Any entry at all, posted or void: an account that has ever held money is not a parent.
  const [held] = await tx.select({ n: sql<number>`count(*)` }).from(entries).where(eq(entries.accountId, parent.id));
  if (Number(held?.n ?? 0) > 0) throw new AccountError(`${parent.name} already holds money of its own, so it cannot hold pockets`);
  const open = await tx
    .select({ currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, parent.id), isNull(accounts.archivedAt)));
  if (open.some((row) => row.currency === pocket.currency)) throw new AccountError(`${parent.name} already has a ${pocket.currency} pocket`);
}

export interface CreateAccountInput {
  name: string;
  kind: AccountKind;
  subtype: AccountSubtype;
  currency: string | null;
  parentId?: string | null;
  icon?: string | null;
  /** Natural sign: money held for assets, amount owed for liabilities. */
  openingBalanceMinor?: number;
  openedOn?: string;
  /** Required when the account currency differs from the workspace base and an opening balance is given. */
  openingRateToBase?: number;
  /** Place among its siblings (the existing `sort_order` column); a pocket's order in its account. Defaults to 0. */
  sortOrder?: number;
}

async function writeAudit(tx: Db, ws: WorkspaceContext, action: string, entityId: string, payload: unknown) {
  await tx.insert(auditLog).values({
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    action,
    entity: 'account',
    entityId,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
  });
}

export async function listAccounts(
  database: Database,
  ws: WorkspaceContext,
  opts: { includeArchived?: boolean } = {},
): Promise<AccountRow[]> {
  return database.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), opts.includeArchived ? undefined : isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.kind), asc(accounts.sortOrder), asc(accounts.name));
}

export async function systemAccountId(tx: Db, ws: WorkspaceContext, key: SystemAccountKey): Promise<string> {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.systemKey, key)));
  if (!row) throw new AccountError(`System account ${key} missing`);
  return row.id;
}

export async function createAccount(database: Database, ws: WorkspaceContext, input: CreateAccountInput): Promise<AccountRow> {
  return database.transaction((tx) => createAccountTx(tx, ws, input));
}

/**
 * Opens an account inside a transaction already running, so a caller can create the account and
 * post against it as one atomic step. `createAccount` is this with a transaction of its own.
 */
export async function createAccountTx(tx: Db, ws: WorkspaceContext, input: CreateAccountInput): Promise<AccountRow> {
  const name = input.name.trim();
  if (!name) throw new AccountError('Name is required');
  if (input.kind === 'asset' || input.kind === 'liability') {
    if (!(BALANCE_SUBTYPES[input.kind] as readonly string[]).includes(input.subtype)) {
      throw new AccountError(`Subtype ${input.subtype} is not valid for ${input.kind}`);
    }
    if (!input.currency) throw new AccountError('Currency is required');
    currencyInfo(input.currency);
  } else if (input.kind === 'income' || input.kind === 'expense') {
    if (input.subtype !== 'category') throw new AccountError('Income and expense accounts must be categories');
    if (input.currency !== null) throw new AccountError('Categories do not have a currency');
  } else {
    throw new AccountError('Equity accounts are system-managed');
  }

  const now = new Date().toISOString();
  const row: AccountRow = {
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    parentId: input.parentId ?? null,
    kind: input.kind,
    subtype: input.subtype,
    name,
    icon: input.icon ?? null,
    currency: input.currency,
    valuationMode: 'derived',
    systemKey: null,
    sortOrder: input.sortOrder ?? 0,
    archivedAt: null,
    createdAt: now,
  };

  {
    if (row.parentId) {
      const [parent] = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, row.parentId), eq(accounts.workspaceId, ws.workspaceId)));
      if (!parent || parent.kind !== row.kind) throw new AccountError('Parent must be an account of the same kind');
      if (row.kind === 'asset' || row.kind === 'liability') await checkPocketTx(tx, ws, row, parent);
    }
    await tx.insert(accounts).values(row);
    if ((row.kind === 'income' || row.kind === 'expense') && (await hasBooks(tx))) {
      // A category belongs to a set of books: the one the context names, or the workspace's first (Personal).
      const bookId = ws.bookId ?? (await personalBookIdTx(tx, ws.workspaceId));
      if (bookId) await tx.insert(bookCategories).values({ categoryAccountId: row.id, workspaceId: ws.workspaceId, bookId });
    }
    const opening = input.openingBalanceMinor ?? 0;
    if (opening !== 0 && (row.kind === 'asset' || row.kind === 'liability')) {
      await postTransactionTx(tx, ws, {
        occurredOn: input.openedOn ?? now.slice(0, 10),
        description: `Opening balance: ${name}`,
        lines: openingBalanceLines({
          accountId: row.id,
          kind: row.kind,
          balanceMinor: opening,
          currency: row.currency!,
          equityAccountId: await systemAccountId(tx, ws, 'opening_balance'),
        }),
        ratesToBase: input.openingRateToBase ? { [row.currency!]: input.openingRateToBase } : {},
      });
    }
    await writeAudit(tx, ws, 'create', row.id, input);
    return row;
  }
}

export async function renameAccount(database: Database, ws: WorkspaceContext, id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new AccountError('Name is required');
  await database.transaction(async (tx) => {
    const [before] = await tx.select({ name: accounts.name }).from(accounts).where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
    await tx.update(accounts).set({ name: trimmed }).where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
    if (before) {
      // Pockets still named after the account follow it; one the owner renamed keeps its own name.
      const pockets = await tx
        .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, id), eq(accounts.kind, 'asset')));
      for (const pocket of pockets) {
        if (pocket.currency && pocket.name === pocketName(before.name, pocket.currency)) {
          await tx.update(accounts).set({ name: pocketName(trimmed, pocket.currency) }).where(eq(accounts.id, pocket.id));
        }
      }
    }
    await writeAudit(tx, ws, 'rename', id, { name: trimmed });
  });
}

/**
 * What one account holds: every posted entry, whatever its date, in the account's own currency. The balance an
 * archive checks is zero. The caller has already found the account in its workspace.
 */
export async function postedBalanceTx(tx: Db, id: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${entries.amountMinor}), 0)` })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(and(eq(entries.accountId, id), eq(transactions.status, 'posted')));
  return Number(row?.total ?? 0);
}

/** Archives inside a transaction already running. Refuses a system account, and a money account that still holds a balance. */
export async function archiveAccountTx(tx: Db, ws: WorkspaceContext, id: string): Promise<void> {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) throw new AccountError('Account not found');
  // Default categories carry keys too; only the system equity accounts are protected.
  if (SYSTEM_ACCOUNTS.some((s) => s.key === account.systemKey)) throw new AccountError('System accounts cannot be archived');
  if (account.kind === 'asset') {
    const open = await tx
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, id), isNull(accounts.archivedAt)))
      .orderBy(asc(accounts.sortOrder), asc(accounts.id));
    if (open.length > 0) {
      throw new AccountError(`${account.name} still has pockets: ${open.map((row) => row.currency).join(', ')}. Archive each pocket first.`);
    }
  }
  if (account.kind === 'asset' || account.kind === 'liability') {
    // Archived money accounts leave net worth, so they must be empty first.
    if ((await postedBalanceTx(tx, id)) !== 0) {
      throw new AccountError(`${account.name} still has a balance. Bring it to zero before archiving so net worth stays correct.`);
    }
  }
  await tx.update(accounts).set({ archivedAt: new Date().toISOString() }).where(eq(accounts.id, id));
  await writeAudit(tx, ws, 'archive', id, {});
}

/**
 * The reverse of `archiveAccountTx`, inside a running transaction: the account is live again, and the audit says so.
 * Used when what archived it is taken back (a deposit's close, reopened by voiding what it posted).
 */
export async function unarchiveAccountTx(tx: Db, ws: WorkspaceContext, id: string): Promise<void> {
  const [account] = await tx
    .select({ id: accounts.id, archivedAt: accounts.archivedAt })
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) throw new AccountError('Account not found');
  if (account.archivedAt === null) return;
  await tx.update(accounts).set({ archivedAt: null }).where(eq(accounts.id, id));
  await writeAudit(tx, ws, 'unarchive', id, {});
}

export async function archiveAccount(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.transaction((tx) => archiveAccountTx(tx, ws, id));
}
