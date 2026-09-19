import { LATEST_VERSION, type SqlExecutor } from '@expanses/db';
import { type FatalKind, fatalKind, fatalReason, messageOf } from './fatal';
import type { RecoveryReason } from './open';

interface Reply {
  id: number;
  result?: unknown;
  error?: string;
  /** Set by the worker when the failure is one the session cannot carry on past. See `fatal.ts`. */
  fatal?: FatalKind;
}

export interface SnapshotExecutor extends SqlExecutor {
  /**
   * A file copy of the database, taken between statements behind the worker's autocommit guard. Separate
   * from `exportBytes` because it is allowed to refuse: a safety copy is never worth a torn read.
   */
  snapshotBytes(): Promise<Uint8Array>;
  /**
   * Registers the one handler that hears a failure this session cannot carry on past (spec §3.4).
   *
   * It is called at most once, with the first such failure. A fatal that has already happened is handed
   * over the moment a handler arrives, so a handler registered a tick late still hears it rather than the
   * app carrying on over a database that has stopped answering.
   */
  onFatal(handler: (reason: RecoveryReason) => void): void;
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
  // The op rides along with each waiter so an untagged failure can be read the same way the worker would
  // have read it — see the narrowing in `worker.ts`: only the app's own reads and writes are ever fatal.
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; op: unknown }>();

  /**
   * The first failure this session cannot carry on past, and whoever is listening for it.
   *
   * Once it is set, nothing is sent to the worker again. That is deliberate and it is the difference
   * between §3.4 working and not: a database that has stopped answering will not answer the next query
   * either, and a promise posted to an engine that cannot reply is the permanent spinner this branch
   * exists to abolish. Every later call is rejected at once instead, so whatever is still on screen when
   * the swap happens fails fast rather than hanging.
   */
  let fatal: RecoveryReason | null = null;
  let listener: ((reason: RecoveryReason) => void) | null = null;

  const strike = (reason: RecoveryReason) => {
    // Only the first one: the ones after it are the same failure arriving again through other queries.
    if (fatal) return;
    fatal = reason;
    for (const waiter of pending.values()) waiter.reject(new Error(reason.detail));
    pending.clear();
    listener?.(reason);
  };

  worker.onmessage = (event: MessageEvent<Reply>) => {
    const waiter = pending.get(event.data.id);
    if (!waiter) return;
    pending.delete(event.data.id);
    if (event.data.error !== undefined) {
      const error = new Error(event.data.error);
      waiter.reject(error);
      /*
       * The worker's tag is the authority — it is standing next to SQLite when the error is raised — but
       * the message is read here as well, so a worker from a build that did not tag still reaches the same
       * screen. The same narrowing applies to that reading: a safety copy or a refused restore failing is
       * never a reason to take a working app away from the person using it.
       */
      const ordinary = waiter.op === 'query' || waiter.op === 'script';
      const kind = event.data.fatal ?? (ordinary ? fatalKind(error) : null);
      if (kind) strike(fatalReason(kind, messageOf(error)));
    } else waiter.resolve(event.data.result);
  };
  worker.onerror = (event) => {
    // The engine itself is gone: nothing pending can be answered, and nothing new can be asked either.
    strike(fatalReason('unreadable', event.message || 'SQLite worker failed'));
  };

  const call = (message: Record<string, unknown>, transfer: Transferable[] = []) =>
    new Promise<unknown>((resolve, reject) => {
      if (fatal) return reject(new Error(fatal.detail));
      const id = ++nextId;
      pending.set(id, { resolve, reject, op: message.op });
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
    onFatal: (handler) => {
      listener = handler;
      // Registered after the fact: the failure is handed over rather than lost. It cannot be dropped on
      // the floor just because it arrived between the open finishing and the app being wired up.
      if (fatal) handler(fatal);
    },
  };
}
