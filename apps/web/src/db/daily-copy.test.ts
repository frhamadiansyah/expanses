import { createDatabase, LATEST_VERSION, migrate, MIGRATIONS } from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSafely, type Safety } from './open';
import { memorySnapshots, scheduleDailyCopy } from './snapshots';

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
    MIGRATIONS.filter((m) => m.version <= LATEST_VERSION - 1),
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
    expect(safety.schemaVersion).toBe(LATEST_VERSION - 1);

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
    expect(copy?.schemaVersion).toBe(LATEST_VERSION - 1);
    expect(copy?.file).toContain(`-v${LATEST_VERSION - 1}-daily.`);
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
