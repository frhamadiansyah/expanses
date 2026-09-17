import { CATALOG } from '@expanses/catalog';
import { isoDate } from '@expanses/core';
import {
  activeBookId,
  contextOf,
  createDatabase,
  createWorkspace,
  type Database,
  ensureCategoryKeys,
  ensureDefaultCategorySets,
  inBook,
  listWorkspaces,
  migrate,
  syncLinkedPrograms,
  type WorkspaceContext,
} from '@expanses/db';
import { createWorkerExecutor } from './worker-executor';

export interface AppDb {
  database: Database;
  ws: WorkspaceContext;
  workspaceName: string;
}

export async function openAppDb(database: Database): Promise<AppDb> {
  await migrate(database);
  let [workspace] = await listWorkspaces(database);
  if (!workspace) {
    await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    [workspace] = await listWorkspaces(database);
  }
  const ws = contextOf(workspace!);
  // Keys first, so catalogue exclusions map to categories when linked programs re-apply.
  await ensureCategoryKeys(database, ws);
  // Then the sets, which a workspace of any age can be missing: they arrive with the feature, not with the workspace.
  await ensureDefaultCategorySets(database, ws);
  try {
    await syncLinkedPrograms(database, ws, CATALOG, isoDate());
  } catch (error) {
    // A bad bundled entry must not stop the app opening; linked cards keep their current terms until the next open.
    console.warn('Catalogue sync failed', error);
  }
  // The set of books last open, or Personal. Owner-level screens ignore it; book-scoped ones read it.
  const opened = inBook(ws, await activeBookId(database, ws));
  return { database, ws: opened, workspaceName: workspace!.name };
}

export async function bootstrap(): Promise<AppDb> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return openAppDb(createDatabase(createWorkerExecutor(worker)));
}
