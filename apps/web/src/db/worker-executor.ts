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
  /**
   * Arms the strike: from here on, a fatal stops the engine being asked anything else.
   *
   * Called once, by `bootstrap`, on an open that succeeded — and deliberately not before. Until then
   * `openSafely` owns every failure and has a typed answer for each of them, and one of those answers is
   * spec §5.3's rollback: a post-migration `integrity_check` that comes back "malformed" is a fatal *and*
   * the exact moment the bytes taken before the update have to go back. Armed from the first message, the
   * strike refused that `import` on this side of the boundary and left the user on a half-updated file
   * with a good copy of the old one three lines away. So the open runs unarmed — a fatal there is still
   * recorded, and still handed to whoever registers — and the strike closes the engine only once the app
   * is the thing holding it.
   */
  arm(): void;
}

/**
 * How long a strike waits for a restore that is already writing the file, in milliseconds.
 *
 * A strike ends with `bootstrap` terminating the worker, and the SAH pool's `importDb` is the one op that
 * is *rewriting the live slot* while it runs: terminated half-way it leaves a torn file and throws away
 * the previous bytes the worker was holding in memory for exactly that rollback. A fatal must never
 * destroy data on its own, so the hand-over waits for the restore to finish putting bytes somewhere — its
 * own `catch` puts the old ones back — rather than cutting it off. Bounded, because the alternative to a
 * torn file must not be a screen that never changes: a restore that has not answered by then is given up
 * on and the swap happens anyway.
 */
const RESTORE_GRACE_MS = 15_000;

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
   * Once it is set *and the strike is armed*, nothing is sent to the worker again. That is deliberate and
   * it is the difference between §3.4 working and not: a database that has stopped answering will not
   * answer the next query either, and a promise posted to an engine that cannot reply is the permanent
   * spinner this branch exists to abolish. Every later call is rejected at once instead, so whatever is
   * still on screen when the swap happens fails fast rather than hanging.
   *
   * Before `arm()` the fatal is recorded and handed over, but the engine stays open to the opener — see
   * `arm` above for why §5.3's rollback depends on it.
   */
  let fatal: RecoveryReason | null = null;
  let listener: ((reason: RecoveryReason) => void) | null = null;
  let armed = false;
  /** True once the fatal may be handed over: at once, or after a restore in flight has stopped writing. */
  let handOverReady = false;
  let handedOver = false;
  /** A restore already posted to the worker, settled either way, or null. See `RESTORE_GRACE_MS`. */
  let restoring: Promise<void> | null = null;

  /**
   * Tells the one listener, once, and never before the hand-over is allowed.
   *
   * Both halves matter. A fatal recorded before anyone was listening is handed over the moment a listener
   * arrives — otherwise the user is left on a screen that can never load anything — and a fatal raised with
   * a listener already there is handed over as soon as it is safe to terminate the engine.
   */
  const handOver = () => {
    if (!fatal || !handOverReady || handedOver || !listener) return;
    handedOver = true;
    listener(fatal);
  };

  const strike = (reason: RecoveryReason) => {
    // Only the first one: the ones after it are the same failure arriving again through other queries.
    if (fatal) return;
    fatal = reason;
    // Everything waiting is rejected rather than left hanging — everything, that is, but a restore that is
    // already rewriting the live file. That one is left to finish, or to put the previous bytes back itself.
    for (const [id, waiter] of pending) {
      if (waiter.op === 'import') continue;
      waiter.reject(new Error(reason.detail));
      pending.delete(id);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      if (handOverReady) return;
      handOverReady = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const waiter of pending.values()) waiter.reject(new Error(reason.detail));
      pending.clear();
      handOver();
    };
    if (!restoring) return release();
    void restoring.then(release, release);
    timer = setTimeout(release, RESTORE_GRACE_MS);
    // Node's timer would hold a test process open for fifteen seconds; the browser's has no such method.
    (timer as unknown as { unref?: () => void }).unref?.();
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
      if (armed && fatal) return reject(new Error(fatal.detail));
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
      const posted = call({ op: 'import', bytes: copy, latestVersion: LATEST_VERSION }, [copy.buffer]);
      // Held so a strike raised while this is in flight waits for it: the worker is rewriting the live slot
      // and terminating it half-way is the one way the swap itself can damage data.
      const settled = posted.then(
        () => undefined,
        () => undefined,
      );
      restoring = settled;
      try {
        await posted;
      } finally {
        if (restoring === settled) restoring = null;
      }
    },
    onFatal: (handler) => {
      listener = handler;
      // Registered after the fact: the failure is handed over rather than lost. It cannot be dropped on
      // the floor just because it arrived between the open finishing and the app being wired up.
      handOver();
    },
    arm: () => {
      armed = true;
    },
  };
}
