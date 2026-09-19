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
});
