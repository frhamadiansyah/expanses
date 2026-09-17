import { currencyInfo, uuidv7 } from '@expanses/core';
import { asc, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, auditLog, workspaceMembers, workspaces } from '../schema';
import { bookCategories } from '../schema-books';
import { DEFAULT_CATEGORIES, SYSTEM_ACCOUNTS } from '../seed';
import { createPersonalBookTx, hasBooks } from './books';

export type WorkspaceType = 'personal' | 'shared' | 'business' | 'travel';
export type WorkspaceRow = typeof workspaces.$inferSelect;
export const LOCAL_USER_ID = 'local';

export function contextOf(row: WorkspaceRow): WorkspaceContext {
  return { workspaceId: row.id, baseCurrency: row.baseCurrency };
}

/** Creates a workspace with its local owner, system equity accounts, and the default category tree. */
export async function createWorkspace(
  database: Database,
  input: { name: string; type: WorkspaceType; baseCurrency: string },
): Promise<WorkspaceContext> {
  currencyInfo(input.baseCurrency);
  const id = uuidv7();
  const now = new Date().toISOString();

  const rows: (typeof accounts.$inferInsert)[] = [];
  const base = { workspaceId: id, icon: null, valuationMode: 'derived' as const, archivedAt: null, createdAt: now };
  for (const sys of SYSTEM_ACCOUNTS) {
    rows.push({ ...base, id: uuidv7(), parentId: null, kind: 'equity', subtype: 'equity', name: sys.name, currency: null, systemKey: sys.key, sortOrder: 0 });
  }
  DEFAULT_CATEGORIES.forEach((category, i) => {
    const parentId = uuidv7();
    rows.push({ ...base, id: parentId, parentId: null, kind: category.kind, subtype: 'category', name: category.name, currency: null, systemKey: category.key, sortOrder: i });
    (category.children ?? []).forEach((child, j) => {
      rows.push({ ...base, id: uuidv7(), parentId, kind: category.kind, subtype: 'category', name: child.name, currency: null, systemKey: child.key, sortOrder: j });
    });
  });

  await database.transaction(async (tx) => {
    await tx.insert(workspaces).values({ id, name: input.name, type: input.type, baseCurrency: input.baseCurrency, plan: 'free', createdAt: now });
    await tx.insert(workspaceMembers).values({ workspaceId: id, userId: LOCAL_USER_ID, role: 'owner' });
    await tx.insert(accounts).values(rows);
    await tx.insert(auditLog).values({ id: uuidv7(), workspaceId: id, action: 'create', entity: 'workspace', entityId: id, payloadJson: JSON.stringify(input), createdAt: now });

    // Every workspace gets a Personal book holding its categories. Skipped on a database still stopped before
    // migration 0042, which has no book tables yet.
    if (await hasBooks(tx)) {
      const bookId = await createPersonalBookTx(tx, id, input.baseCurrency, now);
      const categoryRows = rows.filter((row) => row.kind === 'income' || row.kind === 'expense');
      if (categoryRows.length) {
        await tx.insert(bookCategories).values(categoryRows.map((row) => ({ categoryAccountId: row.id!, workspaceId: id, bookId })));
      }
    }
  });

  return { workspaceId: id, baseCurrency: input.baseCurrency };
}

export async function listWorkspaces(database: Database): Promise<WorkspaceRow[]> {
  return database.db.select().from(workspaces).orderBy(asc(workspaces.createdAt));
}

export async function getWorkspace(database: Database, id: string): Promise<WorkspaceRow | undefined> {
  const [row] = await database.db.select().from(workspaces).where(eq(workspaces.id, id));
  return row;
}
