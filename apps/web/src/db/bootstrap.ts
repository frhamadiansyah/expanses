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
  type Migration,
  syncLinkedPrograms,
  type WorkspaceContext,
} from '@expanses/db';
import { type OpenResult, type OpenStage, openSafely, type Safety, say } from './open';
import { opfsSnapshots } from './snapshots';
import { createWorkerExecutor } from './worker-executor';

/** What the open did to the schema on the way in, and what it chose not to do. Read by the card above the page. */
export interface UpdateOutcome {
  /** Versions applied during this open. Empty on an ordinary launch. */
  applied: number[];
  /** The version the file was at before. 0 means this device had no data: a first run is not an update. */
  from: number;
  /** An update that failed once and is being skipped, or null. Non-null means the app is deliberately behind. */
  blocked: number | null;
}

export interface AppDb {
  database: Database;
  ws: WorkspaceContext;
  workspaceName: string;
  /** Where this app's safety copies go. Absent only where a caller opened a database without a store. */
  safety?: Safety;
  /** Absent only where a caller opened a database without going through `openSafely`. */
  update?: UpdateOutcome;
}

export async function openAppDb(database: Database, migrations?: Migration[]): Promise<AppDb> {
  // The same list the opener was allowed to run: a blocked update must not be slipped in through the back door.
  await migrate(database, migrations);
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

export function createWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

/**
 * The seams the unit test needs. The app never passes either: it starts a real worker and runs the real
 * opener. They exist so that "a failed open releases the worker" can be asserted without OPFS.
 */
export interface BootstrapDeps {
  spawn?: () => Worker;
  open?: typeof openSafely;
}

/**
 * The one entry point the app starts from. Starting the engine is the only step outside `openSafely`,
 * because it is the one failure with nothing to export: there is no database yet to hand back.
 */
export async function bootstrap(onStage: (stage: OpenStage) => void, deps: BootstrapDeps = {}): Promise<OpenResult> {
  const spawn = deps.spawn ?? createWorker;
  const open = deps.open ?? openSafely;
  let worker: Worker;
  let executor: ReturnType<typeof createWorkerExecutor>;
  let database: Database;
  try {
    worker = spawn();
    executor = createWorkerExecutor(worker);
    database = createDatabase(executor);
  } catch (error) {
    return {
      ok: false,
      reason: {
        kind: 'cannot-open',
        headline: 'We could not start the database engine on this device.',
        detail: say(error),
        exportable: false,
      },
    };
  }

  /*
   * Anything but a working app ends with the worker terminated, and this is not tidiness.
   *
   * The SAH pool takes a *sync access handle* on every slot file it owns and holds it for the life of the
   * worker. A worker that is alive but useless — its database corrupt, its migration half-done — still
   * holds them, and OPFS then refuses every write to those files from anywhere else. That is what made
   * "Delete everything on this device" fail with "modifications are not allowed" when it was pressed from
   * `/` rather than from `?recover`, and it would have made Restore fail the same way. Terminating the
   * worker drops the handles, so the fresh worker that the recovery screen borrows can take them.
   *
   * The `finally` is the point: `openSafely` does not only *return* failures. The version read, the
   * future check, the pending list and the post-update check all issue raw queries outside any `try`, so
   * a file that answers one of them with an exception leaves this function by throwing. `main.tsx` then
   * renders the same recovery screen — and its Restore and Start fresh would meet exactly the handles
   * this releases. Released on every exit that is not a working app, thrown or returned.
   */
  let result: OpenResult | undefined;
  try {
    result = await open({
      database,
      snapshots: opfsSnapshots(),
      snapshotBytes: () => executor.snapshotBytes(),
      onStage,
    });
    return result;
  } finally {
    if (!result?.ok) worker.terminate();
  }
}
