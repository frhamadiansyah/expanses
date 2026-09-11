import {
  contextOf,
  createDatabase,
  createWorkspace,
  type Database,
  listWorkspaces,
  migrate,
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
  return { database, ws: contextOf(workspace!), workspaceName: workspace!.name };
}

export async function bootstrap(): Promise<AppDb> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return openAppDb(createDatabase(createWorkerExecutor(worker)));
}
