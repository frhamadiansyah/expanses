import { createDatabase, createWorkspace, migrate, type Database, type WorkspaceContext } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

export interface TestDb {
  executor: NodeExecutor;
  database: Database;
  ws: WorkspaceContext;
}

export async function setupDb(baseCurrency = 'IDR'): Promise<TestDb> {
  const executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency });
  return { executor, database, ws };
}
