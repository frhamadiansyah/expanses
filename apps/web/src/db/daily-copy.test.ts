import { createDatabase, LATEST_VERSION, migrate, MIGRATIONS } from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSafely, type Safety } from './open';
import { memorySnapshots, scheduleDailyCopy } from './snapshots';

/**
 * The version one update behind the newest. Not `LATEST_VERSION - 1`: migration numbers may skip, and they have —
 * 0048 landed after 0049, so for a while the list ran 47, 49 with a hole — so "one behind" is the highest version
 * this build actually carries below its newest.
 */
const PREVIOUS_VERSION = Math.max(...MIGRATIONS.filter((m) => m.version < LATEST_VERSION).map((m) => m.version));

let executor: NodeExecutor | undefined;
afterEach(() => {
  vi.useRealTimers();
  executor?.close();
  executor = undefined;
});

/** A database held one version behind, as a device with a blocked update really is. */
async function heldBack() {
  executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(
    database,
    MIGRATIONS.filter((m) => m.version <= PREVIOUS_VERSION),
  );
  return database;
}

describe('the day’s safety copy', () => {
  it('is labelled with the version the file is at, not the newest this build could reach', async () => {
    const database = await heldBack();
    const store = memorySnapshots();
    // The update this device was told not to attempt, so the open deliberately leaves the file behind.
    await store.block(LATEST_VERSION, LATEST_VERSION);

    const result = await openSafely({ database, snapshots: store, onStage: () => undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const safety = result.app.safety!;
    expect(safety.schemaVersion).toBe(PREVIOUS_VERSION);

    vi.useFakeTimers();
    scheduleDailyCopy(safety);
    await vi.advanceTimersByTimeAsync(2_500);
    vi.useRealTimers();

    const [copy] = await store.list();
    /*
     * The point of the whole test: a copy of a file sitting at `LATEST - 1` used to be recorded and named
     * `-v<LATEST>`, so the Backup page and the recovery screen both stated a schema version those bytes do
     * not have — and on a device holding a block, that is every daily copy it ever takes.
     */
    expect(copy?.schemaVersion).toBe(PREVIOUS_VERSION);
    expect(copy?.file).toContain(`-v${PREVIOUS_VERSION}-daily.`);
    expect(copy?.reason).toBe('daily');

    // And once a session, whatever else mounts: React's StrictMode mounts twice in development, and two
    // copies of the same database inside a second is a wasted write at best.
    vi.useFakeTimers();
    scheduleDailyCopy({ snapshots: store, bytes: () => database.exportBytes(), schemaVersion: safety.schemaVersion } satisfies Safety);
    await vi.advanceTimersByTimeAsync(2_500);
    vi.useRealTimers();
    expect(await store.list()).toHaveLength(1);
  });

  /**
   * A device that never goes idle still gets its copy.
   *
   * `requestIdleCallback` promises only that the callback runs when there is spare time, never that there
   * will be any. A phone reading a big ledger, or a browser on a loaded machine, can stay busy for the whole
   * session — and then the day's copy is never taken, silently, while "Restore the last good copy" goes on
   * offering whatever the last update left. The browser's answer is the `timeout` option, and this is the
   * test that we ask for it: the stub below is a browser that is *never* idle, so the only way the callback
   * can ever run is the deadline. Drop the timeout and no copy is taken and this fails.
   */
  it('is still taken on a device that never goes idle', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS);

    const asked: ({ timeout: number } | undefined)[] = [];
    const host = globalThis as { requestIdleCallback?: unknown };
    const hadIdle = 'requestIdleCallback' in host;
    const previous = host.requestIdleCallback;
    host.requestIdleCallback = (callback: () => void, options?: { timeout: number }) => {
      asked.push(options);
      // Never idle: the callback runs only if a deadline was asked for, exactly as the browser would.
      if (options?.timeout !== undefined) setTimeout(callback, options.timeout);
      return 1;
    };

    try {
      // A fresh module, because the once-a-session guard is a module flag the test above has already set.
      vi.resetModules();
      const fresh = await import('./snapshots');
      const store = fresh.memorySnapshots();

      vi.useFakeTimers();
      fresh.scheduleDailyCopy({ snapshots: store, bytes: () => database.exportBytes(), schemaVersion: LATEST_VERSION });
      await vi.advanceTimersByTimeAsync(2_500);
      vi.useRealTimers();

      expect(asked[0]?.timeout, 'the idle callback was scheduled with no deadline').toBeGreaterThan(0);
      const [copy] = await store.list();
      expect(copy?.reason).toBe('daily');
    } finally {
      if (hadIdle) host.requestIdleCallback = previous;
      else delete host.requestIdleCallback;
      vi.resetModules();
    }
  });
});
