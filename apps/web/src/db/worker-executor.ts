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
  /**
   * Closes the engine to the app deliberately, without a failure having been detected.
   *
   * The strike is the automatic way out; this is the one a caller asks for. It exists for the React error
   * boundary, which replaces the whole app with the recovery screen after a render throws — and that screen
   * offers Restore and Start fresh, both of which write to files this worker is still holding a sync access
   * handle on. Nothing is written here and nothing is diagnosed: every waiter is rejected with a sentence
   * saying why, nothing more is posted, and the caller terminates the worker.
   *
   * `letGo` is when it is safe to terminate, and it is not always now. A restore already posted is
   * rewriting the live slot, and terminating the worker in the middle of that is the one way letting go can
   * damage data — the same hazard `strike()` was taught to wait out, and the same wait, so the two ways out
   * of a session behave alike. Called synchronously when nothing is in flight, which is every ordinary
   * case; called once the restore has stopped writing, or after `RESTORE_GRACE_MS`, when one is.
   */
  release(letGo?: () => void): void;
}

/**
 * How long a strike waits for a restore that is already writing the file, in milliseconds.
 *
 * A strike — and a deliberate `release()`, which ends the same way — has `bootstrap` terminating the
 * worker, and the SAH pool's `importDb` is the one op that
 * is *rewriting the live slot* while it runs: terminated half-way it leaves a torn file and throws away
 * the previous bytes the worker was holding in memory for exactly that rollback. A fatal must never
 * destroy data on its own, so the hand-over waits for the restore to finish putting bytes somewhere — its
 * own `catch` puts the old ones back — rather than cutting it off. Bounded, because the alternative to a
 * torn file must not be a screen that never changes: a restore that has not answered by then is given up
 * on and the swap happens anyway.
 *
 * The bound earns its keep on both ways out, but by different routes, and it is worth saying which. For a
 * strike it is the screen itself: `handOverReady` and `handOver()` are inside the wait, so an unbounded one
 * leaves the user on a broken app for ever. For a `release()` the screen is already drawn — the boundary
 * drew it before asking — and what the bound buys there is the *terminate*, which is the only thing that
 * frees the sync access handles the SAH pool holds on every slot file. Without it a release deferred behind
 * a restore that never answers holds those handles for the life of the tab, and Restore and Start fresh can
 * never be offered again. `releaseEngine` in `screen-failure.ts` hears the late `letGo` and redraws, so the
 * end of the grace is a screen that gains two buttons rather than one that silently cannot.
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

/**
 * How long to wait for the engine's very first reply of any kind, in milliseconds.
 *
 * Defence in depth behind `gone`. `worker.onerror` covers the module that fails to load, but it is a
 * signal the browser has to send: a worker that starts and then simply never answers — a VFS install that
 * hangs instead of rejecting, a message lost between the two sides — raises nothing at all, and the open
 * would wait on it for the life of the tab. That is the same permanent spinner by a quieter route, so the
 * wait is bounded and the silence is named: `unreadable`, with Export, Restore and Try again on the screen.
 *
 * It watches the *handshake only* and stops for good at the first reply, which is what makes it safe to
 * have at all. A blanket per-call timeout would eventually fire on a long migration over a large database
 * and terminate the worker in the middle of writing it — a fatal destroying data on its own, which is the
 * one thing this branch forbids. Before the engine has answered once, nothing of the sort can be in
 * flight: every op `openSafely` issues before the first reply is a read.
 *
 * A minute, and not the half-minute it started as, because of what the window actually contains. The timer
 * is armed at the first `postMessage`, which happens before the worker module has even been fetched: a cold
 * first load has to pull the worker chunk and `sqlite3.wasm` — about 1.1 MB, and the service worker's
 * cache cannot help the *first* load, which is exactly the slow-phone case this is sized for — compile the
 * wasm, and then let `installOpfsSAHPoolVfs` create the pool's slot files. A page frozen by an OS sleep or
 * a backgrounded tab resumes its timer promptly on wake, too, so a user who launches the app and pockets
 * the phone inside the window can come back to a fired watchdog over a perfectly healthy database. Firing
 * costs nothing but a trip through the recovery screen — nothing has been written, and Try again reloads
 * into a working app — but a bound nobody reaches is still a bound, and this one should be reached only by
 * an engine that really is never going to speak.
 */
const HANDSHAKE_MS = 60_000;

const isBusy = (error: unknown): boolean => /busy/i.test(error instanceof Error ? error.message : String(error));

/** What a query still in flight is told when the app lets go of the engine on purpose. Never shown above the fold. */
const RELEASED = 'Expanses let go of the database so this screen could offer to put a copy back.';

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
  /**
   * The engine itself is gone — `worker.onerror` fired — and nothing may be posted to it again, ever,
   * armed or not.
   *
   * This is deliberately a second flag rather than the `fatal` one above, because the two strikers are not
   * the same event. A reply-tagged fatal means *the database is bad while the worker still answers*, and
   * that one must stay postable until `arm()` so §5.3's rollback can put the pre-update bytes back through
   * the worker's own `import`. `worker.onerror` means *there is nobody on the other side*: the worker's
   * module never evaluated — a precached chunk gone bad, a module fetch that failed on the first load after
   * an update, an uncaught top-level throw — so `self.onmessage` was never installed and no message will
   * ever be answered. An `import` posted there hangs exactly as surely as a `query` does.
   *
   * Sharing the `armed` gate between them is what left the opening screen on the page for ever: the strike
   * rejected what was pending, `databaseVersion`'s catch then asked `checkStructure`, and that query went to
   * an engine that could not reply. Nothing on the open path times out, so `openSafely` never returned and
   * the user was left on a spinner with no button on it. Refused here instead, the same failure comes back
   * as a typed `unreadable` reason and the recovery screen.
   */
  let gone = false;
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

  /**
   * The one way this engine is ever closed, whichever of the two ways out asked for it.
   *
   * Everything still waiting is rejected with `detail` — a promise on an engine nobody holds any more is
   * the permanent spinner by another name — and then `then` runs: the hand-over, for a strike, or the
   * caller's terminate, for a deliberate `release()`. Both end in `bootstrap` calling `worker.terminate()`,
   * so both have the same one thing they must not interrupt: a restore already inside `importDb`, which is
   * rewriting the live slot and holding the previous bytes in memory for its own rollback. Cut off there it
   * leaves a torn file and loses the copy that would have undone it — a safety mechanism destroying data,
   * which is the one thing this branch forbids. So the close waits for the restore to stop writing, and is
   * bounded by `RESTORE_GRACE_MS`, because the alternative to a torn file must not be a screen that never
   * changes. Written once and shared, so the two ways out cannot drift apart again.
   */
  const closeDown = (detail: string, then: () => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const waiter of pending.values()) waiter.reject(new Error(detail));
      pending.clear();
      then();
    };
    if (!restoring) return finish();
    void restoring.then(finish, finish);
    timer = setTimeout(finish, RESTORE_GRACE_MS);
    // Node's timer would hold a test process open for fifteen seconds; the browser's has no such method.
    (timer as unknown as { unref?: () => void }).unref?.();
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
    closeDown(reason.detail, () => {
      handOverReady = true;
      handOver();
    });
  };

  /** The handshake watchdog, or undefined once the engine has spoken (or the watchdog has fired). */
  let handshake: ReturnType<typeof setTimeout> | undefined;
  let answered = false;

  worker.onmessage = (event: MessageEvent<Reply>) => {
    // Any reply at all, for any id, proves there is a worker on the other side listening. From here the
    // engine is judged by what it says, never by the clock.
    answered = true;
    if (handshake !== undefined) {
      clearTimeout(handshake);
      handshake = undefined;
    }
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
    // Set before the strike, so a listener told synchronously inside it already sees a closed engine.
    gone = true;
    strike(fatalReason('unreadable', event.message || 'SQLite worker failed'));
  };

  const call = (message: Record<string, unknown>, transfer: Transferable[] = []) =>
    new Promise<unknown>((resolve, reject) => {
      // `gone` is unconditional and `armed && fatal` is not: see `gone` above for why they differ.
      // `fatal` is null only when `release()` was what closed the engine: nothing went wrong, we let go.
      if (gone || (armed && fatal)) return reject(new Error(fatal?.detail ?? RELEASED));
      const id = ++nextId;
      pending.set(id, { resolve, reject, op: message.op });
      worker.postMessage({ ...message, id }, transfer);
      if (answered || handshake !== undefined) return;
      handshake = setTimeout(() => {
        handshake = undefined;
        // Nothing has ever come back, so nothing has ever been written: this is safe to call from a timer
        // in a way a per-call timeout would not be. See `HANDSHAKE_MS`.
        gone = true;
        strike(fatalReason('unreadable', `The database engine did not answer within ${HANDSHAKE_MS / 1000} seconds`));
      }, HANDSHAKE_MS);
      // Node's timer would hold a test process open for half a minute; the browser's has no such method.
      (handshake as unknown as { unref?: () => void }).unref?.();
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
    release: (letGo = () => undefined) => {
      // Already closed — struck, or let go once before. Nothing more to shut, but the caller still
      // terminates: a boundary reached after `worker.onerror` must drop the handles like any other.
      if (gone) return closeDown(RELEASED, letGo);
      gone = true;
      if (handshake !== undefined) {
        clearTimeout(handshake);
        handshake = undefined;
      }
      // Rejected rather than left hanging, for the same reason the strike rejects: a promise waiting on an
      // engine nobody is holding any more is the permanent spinner by another name. The screen that asked
      // for this is already drawn over whatever was reading. A restore in flight is skipped here exactly as
      // the strike skips it — `closeDown` is what waits for it, and what tells the caller when to terminate.
      for (const [id, waiter] of pending) {
        if (waiter.op === 'import') continue;
        waiter.reject(new Error(RELEASED));
        pending.delete(id);
      }
      closeDown(RELEASED, letGo);
    },
  };
}
