import { LATEST_VERSION, type SqlExecutor } from '@expanses/db';

interface Reply {
  id: number;
  result?: unknown;
  error?: string;
}

export interface SnapshotExecutor extends SqlExecutor {
  /**
   * A file copy of the database, taken between statements behind the worker's autocommit guard. Separate
   * from `exportBytes` because it is allowed to refuse: a safety copy is never worth a torn read.
   */
  snapshotBytes(): Promise<Uint8Array>;
}

/**
 * How long to keep asking for a safety copy while a transaction is in flight, in milliseconds between
 * attempts.
 *
 * One macrotask was the old answer and it was the wrong one: a transaction in this app is several
 * round trips to the worker — `BEGIN IMMEDIATE`, the statements, `COMMIT` — each its own message and its
 * own turn of the event loop, so a single `setTimeout(0)` cannot outlast even a short one. The day's copy
 * was then given up on until the next page load, over a transaction that finished milliseconds later.
 * These back off to about five seconds in total, which comfortably covers an ordinary write and still
 * ends: a copy is never worth waiting on for ever, and the caller is told when it is given up.
 */
const BUSY_RETRY_MS = [25, 75, 200, 500, 1200, 3000];

const isBusy = (error: unknown): boolean => /busy/i.test(error instanceof Error ? error.message : String(error));

export function createWorkerExecutor(worker: Worker): SnapshotExecutor {
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  worker.onmessage = (event: MessageEvent<Reply>) => {
    const waiter = pending.get(event.data.id);
    if (!waiter) return;
    pending.delete(event.data.id);
    if (event.data.error !== undefined) waiter.reject(new Error(event.data.error));
    else waiter.resolve(event.data.result);
  };
  worker.onerror = (event) => {
    for (const waiter of pending.values()) waiter.reject(new Error(event.message || 'SQLite worker failed'));
    pending.clear();
  };

  const call = (message: Record<string, unknown>, transfer: Transferable[] = []) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });

  return {
    query: (sql, params, method) => call({ op: 'query', sql, params, method }),
    execScript: async (sql) => {
      await call({ op: 'script', sql });
    },
    exportBytes: async () => (await call({ op: 'export' })) as Uint8Array,
    snapshotBytes: async () => {
      for (const wait of BUSY_RETRY_MS) {
        try {
          return (await call({ op: 'snapshot' })) as Uint8Array;
        } catch (error) {
          // Anything but "a transaction is open" is the answer, not a reason to ask again.
          if (!isBusy(error)) throw error;
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
      }
      // The last attempt, and the one whose failure is reported: the copy is given up on rather than
      // waited for, the open carries on without it, and the user is told there is none.
      return (await call({ op: 'snapshot' })) as Uint8Array;
    },
    importBytes: async (bytes) => {
      const copy = bytes.slice();
      // What this build knows goes with the file, so the engine can refuse one written by a newer build
      // before it becomes the live database rather than after.
      await call({ op: 'import', bytes: copy, latestVersion: LATEST_VERSION }, [copy.buffer]);
    },
  };
}
