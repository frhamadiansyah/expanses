import { afterEach, describe, expect, it, vi } from 'vitest';
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
