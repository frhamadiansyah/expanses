import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecoveryReason } from './open';
import { createWorkerExecutor } from './worker-executor';

/**
 * A worker that answers `snapshot` with "busy" a set number of times before handing the bytes over, and
 * answers every other op at once. Enough of a `Worker` for the executor: a `postMessage` and an
 * `onmessage` it can be given.
 */
function busyWorker(times: number) {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  let asked = 0;
  const worker = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage(message: { id: number; op: string }) {
      const answer = (reply: Record<string, unknown>) => queueMicrotask(() => worker.onmessage?.({ data: reply } as MessageEvent<unknown>));
      if (message.op !== 'snapshot') return answer({ id: message.id, result: null });
      asked += 1;
      if (asked <= times) return answer({ id: message.id, error: 'busy' });
      return answer({ id: message.id, result: bytes });
    },
  };
  return { worker, bytes, asked: () => asked };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the safety copy the worker may refuse', () => {
  it('waits out a transaction that takes several round trips, rather than giving up after one', async () => {
    /*
     * One `setTimeout(0)` was the old wait. A transaction in this app is `BEGIN IMMEDIATE`, its statements
     * and `COMMIT` — each a separate message to the worker and a separate turn of the event loop — so a
     * single macrotask could not outlast even a short one, and the day's copy was abandoned until the next
     * page load over a write that finished milliseconds later.
     */
    vi.useFakeTimers();
    const { worker, bytes, asked } = busyWorker(4);
    const executor = createWorkerExecutor(worker as unknown as Worker);

    const copy = executor.snapshotBytes();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(Array.from(await copy)).toEqual(Array.from(bytes));
    expect(asked()).toBe(5);
  });

  it('gives up in the end rather than waiting for ever, and says why', async () => {
    vi.useFakeTimers();
    const { worker, asked } = busyWorker(Number.POSITIVE_INFINITY);
    const executor = createWorkerExecutor(worker as unknown as Worker);

    const copy = executor.snapshotBytes();
    const settled = copy.then(
      () => 'kept',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    await vi.advanceTimersByTimeAsync(60_000);

    // The caller is told, and carries on without a copy: a safety net is never a wall.
    expect(await settled).toBe('busy');
    expect(asked()).toBeGreaterThan(1);
  });

  it('never asks twice about anything but a transaction in flight', async () => {
    const worker = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      calls: 0,
      postMessage(message: { id: number }) {
        worker.calls += 1;
        queueMicrotask(() => worker.onmessage?.({ data: { id: message.id, error: 'disk I/O error' } } as MessageEvent<unknown>));
      },
    };
    const executor = createWorkerExecutor(worker as unknown as Worker);
    await expect(executor.snapshotBytes()).rejects.toThrow(/disk I\/O error/);
    expect(worker.calls).toBe(1);
  });
});

/**
 * A worker that answers every request with `answer`, and hands out its own `onmessage`/`onerror` so a test
 * can play the part of an engine that has stopped being one.
 */
function scriptedWorker(answer: (message: { id: number; op: string }) => Record<string, unknown>) {
  const worker = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    sent: [] as { id: number; op: string }[],
    terminated: 0,
    postMessage(message: { id: number; op: string }) {
      worker.sent.push(message);
      queueMicrotask(() => worker.onmessage?.({ data: answer(message) } as MessageEvent<unknown>));
    },
    terminate() {
      worker.terminated += 1;
    },
  };
  return worker;
}

describe('a failure the session cannot carry on past', () => {
  it('tells the one listener, rejects what was in flight, and never asks the engine anything again', async () => {
    // A worker that answers the first query with a corrupt page and then never answers anything.
    const worker = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      sent: [] as { id: number; op: string }[],
      postMessage(message: { id: number; op: string }) {
        worker.sent.push(message);
        if (worker.sent.length > 1) return; // the other query is left hanging, as a dead engine leaves it
        queueMicrotask(() =>
          worker.onmessage?.({ data: { id: message.id, error: 'database disk image is malformed', fatal: 'corrupt' } } as MessageEvent<unknown>),
        );
      },
    };
    const executor = createWorkerExecutor(worker as unknown as Worker);
    const heard: RecoveryReason[] = [];
    executor.onFatal((reason) => heard.push(reason));

    const first = executor.query('select 1', [], 'all');
    const alongside = executor.query('select 2', [], 'all');

    await expect(first).rejects.toThrow(/malformed/);
    // The query that was in flight when the engine gave up is rejected too, rather than waiting for ever:
    // a promise nobody will ever settle is the permanent spinner this whole branch exists to abolish.
    await expect(alongside).rejects.toThrow(/malformed/);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ kind: 'corrupt', midSession: true, exportable: true });

    // And nothing else is posted to it: every later call is refused here, on this side of the boundary.
    const sentBefore = worker.sent.length;
    await expect(executor.query('select 3', [], 'all')).rejects.toThrow(/malformed/);
    await expect(executor.execScript('vacuum')).rejects.toThrow(/malformed/);
    expect(worker.sent).toHaveLength(sentBefore);
    // Still only the first one: the failures after it are the same failure arriving through other queries.
    expect(heard).toHaveLength(1);
  });

  it('reads the engine’s own words when the reply carries no tag, for the ops the worker would have tagged', async () => {
    const worker = scriptedWorker((message) => ({ id: message.id, error: 'disk I/O error' }));
    const executor = createWorkerExecutor(worker as unknown as Worker);
    const heard: RecoveryReason[] = [];
    executor.onFatal((reason) => heard.push(reason));

    await expect(executor.query('select 1', [], 'all')).rejects.toThrow(/disk I\/O error/);
    expect(heard).toHaveLength(1);
    expect(heard[0]?.kind).toBe('unreadable');
  });

  it('never takes the app away over a safety copy or a refused restore', async () => {
    /*
     * The same disk I/O error, from the ops that already have an answer for it: a copy that could not be
     * taken is a copy that is not taken, and a file the engine refuses leaves the database exactly where
     * it was. Neither is a reason to replace a working app with a recovery screen.
     */
    const worker = scriptedWorker((message) => ({ id: message.id, error: 'disk I/O error' }));
    const executor = createWorkerExecutor(worker as unknown as Worker);
    const heard: RecoveryReason[] = [];
    executor.onFatal((reason) => heard.push(reason));

    await expect(executor.snapshotBytes()).rejects.toThrow(/disk I\/O error/);
    await expect(executor.importBytes(new Uint8Array([1, 2, 3]))).rejects.toThrow(/disk I\/O error/);
    expect(heard).toEqual([]);
    // And the engine is still being asked things, because as far as this app is concerned it still works.
    await expect(executor.exportBytes()).rejects.toThrow(/disk I\/O error/);
  });

  it('leaves an ordinary failure ordinary', async () => {
    const worker = scriptedWorker((message) => ({ id: message.id, error: 'UNIQUE constraint failed: accounts.id' }));
    const executor = createWorkerExecutor(worker as unknown as Worker);
    const heard: RecoveryReason[] = [];
    executor.onFatal((reason) => heard.push(reason));

    await expect(executor.query('insert into accounts values (1)', [], 'run')).rejects.toThrow(/UNIQUE/);
    expect(heard).toEqual([]);
    // The next query goes out as usual: one rejected write is not the end of a session.
    await expect(executor.query('select 1', [], 'all')).rejects.toThrow(/UNIQUE/);
    expect(worker.sent).toHaveLength(2);
  });

  it('counts the engine dying as the same thing, and hands it to a listener that arrives late', async () => {
    const worker = scriptedWorker((message) => ({ id: message.id, result: [] }));
    const executor = createWorkerExecutor(worker as unknown as Worker);

    worker.onerror?.({ message: 'SQLite worker failed' } as ErrorEvent);

    const heard: RecoveryReason[] = [];
    executor.onFatal((reason) => heard.push(reason));
    // Registered after the fact and still told: a failure between the open finishing and the app being
    // wired up must not be dropped, or the user is left looking at a screen that cannot load anything.
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ kind: 'unreadable', midSession: true });
    await expect(executor.query('select 1', [], 'all')).rejects.toThrow(/SQLite worker failed/);
  });
});
