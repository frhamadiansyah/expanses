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
  asset: ['cash', 'bank', 'savings', 'investment', 'property', 'vehicle', 'receivable'],
  liability: ['credit_card', 'loan', 'payable'],
} as const satisfies Record<'asset' | 'liability', readonly AccountSubtype[]>;

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
    sortOrder: 0,
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
    await tx.update(accounts).set({ name: trimmed }).where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
    await writeAudit(tx, ws, 'rename', id, { name: trimmed });
  });
}

export async function archiveAccount(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
    if (!account) throw new AccountError('Account not found');
    // Default categories carry keys too; only the system equity accounts are protected.
    if (SYSTEM_ACCOUNTS.some((s) => s.key === account.systemKey)) throw new AccountError('System accounts cannot be archived');
    if (account.kind === 'asset' || account.kind === 'liability') {
      // Archived money accounts leave net worth, so they must be empty first.
      const [row] = await tx
        .select({ total: sql<number>`coalesce(sum(${entries.amountMinor}), 0)` })
        .from(entries)
        .innerJoin(transactions, eq(entries.transactionId, transactions.id))
        .where(and(eq(entries.accountId, id), eq(transactions.status, 'posted')));
      if (Number(row?.total ?? 0) !== 0) {
        throw new AccountError(`${account.name} still has a balance. Bring it to zero before archiving so net worth stays correct.`);
      }
    }
    await tx.update(accounts).set({ archivedAt: new Date().toISOString() }).where(eq(accounts.id, id));
    await writeAudit(tx, ws, 'archive', id, {});
  });
}
