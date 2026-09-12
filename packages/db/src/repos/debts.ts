import type { DebtDirection, DebtStatus } from '@expanses/core';
import { and, asc, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { debtProfiles } from '../schema-debts';

export class DebtDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DebtDbError';
  }
}

/** Money lent sits in a receivable; money borrowed sits in a payable. Nothing else may carry a person. */
const DIRECTION_BY_SUBTYPE: Record<string, DebtDirection> = { receivable: 'lent', payable: 'borrowed' };

/** What the Coretax tables call each side when no related-party code is chosen. */
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
