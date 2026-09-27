import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncScheduler } from './sync-scheduler';

/*
 * §9.4: sync when the app comes to the foreground and every 30 s while open; a failure retries with exponential
 * backoff capped at 5 minutes; one run at a time. `syncOnce` (outbox drain + pull, tasks 3–4) is a callback here.
 */

const S = 1000;

/** A `syncOnce` whose calls each wait for the test to settle them. */
function controlled() {
  const pending: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  const syncOnce = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return {
    syncOnce,
    async succeed() {
      pending.shift()!.resolve();
      await vi.advanceTimersByTimeAsync(0);
    },
    async fail() {
      pending.shift()!.reject(new Error('relay down'));
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SyncScheduler', () => {
  it('runs at start, then every 30 s after each success', async () => {
    const syncOnce = vi.fn(async () => {});
    const scheduler = new SyncScheduler({ syncOnce });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncOnce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29 * S);
    expect(syncOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 * S);
    expect(syncOnce).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30 * S);
    expect(syncOnce).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it('backs off exponentially after failures, capped at 5 minutes, and returns to 30 s on success', async () => {
    let failing = true;
    const calls: number[] = [];
    const syncOnce = vi.fn(async () => {
      calls.push(Date.now());
      if (failing) throw new Error('relay down');
    });
    const onError = vi.fn();
    const start = Date.now();
    const scheduler = new SyncScheduler({ syncOnce, onError });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(22 * 60 * S); // tries at 0, 1, 3, 7, 12, 17 and 22 minutes
    const gaps = calls.slice(1).map((t, i) => (t - calls[i]!) / S);
    expect(gaps.slice(0, 6)).toEqual([60, 120, 240, 300, 300, 300]);
    expect(onError).toHaveBeenCalled();
    expect(calls[0]).toBe(start);

    failing = false;
    const before = syncOnce.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300 * S); // the pending 5-minute retry now succeeds
    expect(syncOnce.mock.calls.length).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(30 * S);
    expect(syncOnce.mock.calls.length).toBe(before + 2);
    expect(calls.at(-1)! - calls.at(-2)!).toBe(30 * S);
    scheduler.stop();
  });

  it('a foreground trigger runs now, even inside a backoff wait', async () => {
    const control = controlled();
    const scheduler = new SyncScheduler({ syncOnce: control.syncOnce });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await control.fail(); // next try would be in 60 s

    const run = scheduler.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(control.syncOnce).toHaveBeenCalledTimes(2);
    await control.succeed();
    await expect(run).resolves.toBeUndefined();

    // Success resets the schedule to 30 s from now.
    await vi.advanceTimersByTimeAsync(29 * S);
    expect(control.syncOnce).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1 * S);
    expect(control.syncOnce).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it('never runs two at once: a trigger during a run queues exactly one more after it', async () => {
    const control = controlled();
    const scheduler = new SyncScheduler({ syncOnce: control.syncOnce });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(control.syncOnce).toHaveBeenCalledTimes(1);

    const a = scheduler.trigger();
    const b = scheduler.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(control.syncOnce).toHaveBeenCalledTimes(1); // still the first run

    await control.succeed(); // first run ends; the queued follow-up starts
    expect(control.syncOnce).toHaveBeenCalledTimes(2);
    await control.succeed();
    await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined]);
    expect(control.syncOnce).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('the interval timer waits while a slow run is in flight', async () => {
    const control = controlled();
    const scheduler = new SyncScheduler({ syncOnce: control.syncOnce });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10 * 60 * S); // the first run never finishes
    expect(control.syncOnce).toHaveBeenCalledTimes(1);
    await control.succeed();
    await vi.advanceTimersByTimeAsync(30 * S);
    expect(control.syncOnce).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('a trigger rejects with nothing: a failed run is reported through onError, never thrown at the caller', async () => {
    const onError = vi.fn();
    const scheduler = new SyncScheduler({
      syncOnce: async () => {
        throw new Error('nope');
      },
      onError,
    });
    await expect(scheduler.trigger()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'nope' }));
  });

  it('stop cancels the timer, and a run finishing after stop schedules nothing', async () => {
    const control = controlled();
    const scheduler = new SyncScheduler({ syncOnce: control.syncOnce });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.stop();
    await control.succeed();
    await vi.advanceTimersByTimeAsync(60 * 60 * S);
    expect(control.syncOnce).toHaveBeenCalledTimes(1);
  });

  it('start twice is one schedule', async () => {
    const syncOnce = vi.fn(async () => {});
    const scheduler = new SyncScheduler({ syncOnce });
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(30 * S);
    expect(syncOnce).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});
