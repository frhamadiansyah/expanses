import { and, asc, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { depositTerms } from '../schema-assets';

export interface DepositTermsRow {
  accountId: string;
  workspaceId: string;
  /** The day the money comes back. Nothing is automated off it unless the owner switches automation on (0054). */
  maturesOn: string;
  rateBps: number;
  createdAt: string;
}

/**
 * Whether migration 0047 has run on this database. Every read and write of deposit_terms asks first, so a
 * database stopped at an older version simply has no deposits. A positive answer is remembered per handle;
 * a negative one is not, since migrate() may run later on the same handle.
 */
const depositTables = new WeakMap<Db, boolean>();

export async function depositTablesExist(db: Db): Promise<boolean> {
  if (depositTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'deposit_terms'`);
  const exists = rows.length > 0;
  if (exists) depositTables.set(db, true);
  return exists;
}

export interface SaveDepositTermsInput {
  accountId: string;
  maturesOn: string;
  rateBps?: number;
}

/**
 * The maturity and the rate beside a time deposit, inside a transaction already running, so the account
 * and its terms are written as one atomic step.
 */
export async function saveDepositTermsTx(tx: Db, ws: WorkspaceContext, input: SaveDepositTermsInput): Promise<void> {
  if (!(await depositTablesExist(tx))) return;
  const values = {
    accountId: input.accountId,
    workspaceId: ws.workspaceId,
    maturesOn: input.maturesOn,
    rateBps: input.rateBps ?? 0,
    createdAt: new Date().toISOString(),
  };
  const { createdAt, ...changes } = values;
  await tx.insert(depositTerms).values(values).onConflictDoUpdate({ target: depositTerms.accountId, set: changes });
}

/** `saveDepositTermsTx` with a transaction of its own, for a deposit whose account already exists. */
export async function saveDepositTerms(database: Database, ws: WorkspaceContext, input: SaveDepositTermsInput): Promise<void> {
  await database.transaction((tx) => saveDepositTermsTx(tx, ws, input));
}

/** The terms of one deposit, on any handle: a transaction already running, or `database.db`. */
export async function getDepositTermsTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<DepositTermsRow | undefined> {
  if (!(await depositTablesExist(tx))) return undefined;
  const [row] = await tx
    .select()
    .from(depositTerms)
    .where(and(eq(depositTerms.accountId, accountId), eq(depositTerms.workspaceId, ws.workspaceId)));
  return row;
}

export function getDepositTerms(database: Database, ws: WorkspaceContext, accountId: string): Promise<DepositTermsRow | undefined> {
  return getDepositTermsTx(database.db, ws, accountId);
}

/** Every deposit of the workspace, the one maturing soonest first. */
export async function listDepositTerms(database: Database, ws: WorkspaceContext): Promise<DepositTermsRow[]> {
  if (!(await depositTablesExist(database.db))) return [];
  return database.db.select().from(depositTerms).where(eq(depositTerms.workspaceId, ws.workspaceId)).orderBy(asc(depositTerms.maturesOn));
}
