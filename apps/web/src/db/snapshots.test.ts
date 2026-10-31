import { createDatabase } from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastGoodCopy } from '../features/recovery/recovery-copy';
import { dailyDue, snapshotName } from './snapshot-policy';
import { memorySnapshots, restoreSnapshot, writeWhole } from './snapshots';

const engines: NodeExecutor[] = [];
afterEach(() => {
  vi.useRealTimers();
  while (engines.length) engines.pop()!.close();
});

/** A real SQLite file, `blob` bytes of payload large. */
async function database(blob = 0): Promise<Uint8Array> {
  const engine = createNodeExecutor();
  engines.push(engine);
  const db = createDatabase(engine);
  await db.execScript(`CREATE TABLE t (x BLOB); INSERT INTO t VALUES (zeroblob(${blob}));`);
  return db.exportBytes();
}

async function at<T>(iso: string, run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
  try {
    return await run();
  } finally {
    vi.useRealTimers();
  }
}

describe('a copy is listed only if it is really a copy', () => {
  /** One good copy, and every way a bad one has been found on a device sitting beside it. */
  async function deviceWithBadCopies() {
    const bytes = await database();
    const files = new Map<string, Uint8Array>();
    const store = memorySnapshots(files);
    const good = await at('2026-09-15T10:00:00.000Z', () => store.write(bytes, 'daily', 108));
    // A write that stopped after the file was made: the 0-byte "last good copy" the owner's phone offered.
    const empty = snapshotName('2026-09-16T10:00:00.000Z', 108, 'daily');
    files.set(empty, new Uint8Array());
    // One that stopped part-way through the first page.
    const short = snapshotName('2026-09-17T10:00:00.000Z', 108, 'daily');
    files.set(short, bytes.slice(0, 100));
    // One the right size with the wrong bytes in it.
    const junk = snapshotName('2026-09-18T10:00:00.000Z', 108, 'daily');
    files.set(junk, new Uint8Array(4096).fill(0xff));
    // One the manifest knows, cut shorter than the manifest says it was written.
    const cut = await at('2026-09-19T10:00:00.000Z', () => store.write(bytes, 'before-migration', 108));
    files.set(cut.file, bytes.slice(0, bytes.length - 512));
    return { bytes, files, store, good, bad: [empty, short, junk, cut.file] };
  }

  it('leaves out an empty, short, foreign or cut-short file, so nothing offers or counts it', async () => {
    const { store, good } = await deviceWithBadCopies();
    const listed = await store.list();
    expect(listed.map((s) => s.file)).toEqual([good.file]);
    // Not counted as the day's copy, and not the copy the big button offers.
    expect(dailyDue(listed, new Date('2026-09-19T12:00:00.000Z'))).toBe(true);
    expect(lastGoodCopy(listed)?.file).toBe(good.file);
  });

  it('removes them at the next copy that is written and read back, and keeps the good one', async () => {
    const { bytes, files, store, good, bad } = await deviceWithBadCopies();
    const fresh = await at('2026-09-20T10:00:00.000Z', () => store.write(bytes, 'daily', 108));
    for (const file of bad) expect(files.has(file)).toBe(false);
    expect((await store.list()).map((s) => s.file).sort()).toEqual([fresh.file, good.file].sort());
  });

  it('keeps the copy that held everything when the copies after it are a fraction of its size', async () => {
    const full = await database(400_000);
    const small = await database();
    const store = memorySnapshots();
    const whole = await at('2026-09-15T10:00:00.000Z', () => store.write(full, 'daily', 108));
    await at('2026-09-16T10:00:00.000Z', () => store.write(small, 'daily', 108));
    await at('2026-09-17T10:00:00.000Z', () => store.write(small, 'daily', 108));
    await at('2026-09-18T10:00:00.000Z', () => store.write(small, 'daily', 108));
    const listed = await store.list();
    expect(listed.map((s) => s.file)).toContain(whole.file);
    expect(listed).toHaveLength(3);
  });
});

describe('putting a copy back', () => {
  it('refuses bytes that are not a database before it keeps or replaces anything', async () => {
    const files = new Map<string, Uint8Array>();
    const store = memorySnapshots(files);
    const empty = snapshotName('2026-09-16T10:00:00.000Z', 108, 'daily');
    files.set(empty, new Uint8Array());
    const live = await database();
    const restore = vi.fn(async () => undefined);

    await expect(restoreSnapshot({ snapshots: store, file: empty, live: async () => live, restore })).rejects.toThrow(/cannot be put back/);
    expect(restore).not.toHaveBeenCalled();
    // No before-restore copy either: nothing on the device changed.
    expect([...files.keys()]).toEqual([empty]);
  });

  it('refuses a copy shorter than its own header says', async () => {
    const bytes = await database(100_000);
    const store = memorySnapshots(new Map([[snapshotName('2026-09-16T10:00:00.000Z', 108, 'daily'), bytes.slice(0, 8192)]]));
    const restore = vi.fn(async () => undefined);
    await expect(
      restoreSnapshot({ snapshots: store, file: snapshotName('2026-09-16T10:00:00.000Z', 108, 'daily'), live: async () => null, restore }),
    ).rejects.toThrow(/cannot be put back/);
    expect(restore).not.toHaveBeenCalled();
  });
});

describe('writing a copy file', () => {
  /** A directory handle whose writable stream fails at `failAt`. */
  function directory(failAt: 'write' | 'close' | 'create' | null) {
    const files = new Map<string, number>();
    const removed: string[] = [];
    const dir = {
      getFileHandle: async (name: string) => {
        files.set(name, 0);
        return {
          createWritable: async () => {
            if (failAt === 'create') throw new Error('no writable');
            return {
              write: async (bytes: Uint8Array) => {
                if (failAt === 'write') throw new Error('QuotaExceededError');
                files.set(name, bytes.length);
              },
              close: async () => {
                if (failAt === 'close') throw new Error('close failed');
              },
            };
          },
        };
      },
      removeEntry: async (name: string) => {
        removed.push(name);
        files.delete(name);
      },
    };
    return { dir, files, removed };
  }

  for (const failAt of ['create', 'write', 'close'] as const) {
    it(`leaves no file behind when the ${failAt} step fails`, async () => {
      const { dir, files, removed } = directory(failAt);
      await expect(writeWhole(dir as never, 'snapshot-x.sqlite3', new Uint8Array(1024))).rejects.toThrow();
      expect(removed).toEqual(['snapshot-x.sqlite3']);
      expect(files.size).toBe(0);
    });
  }

  it('leaves the file when every step worked', async () => {
    const { dir, files, removed } = directory(null);
    await writeWhole(dir as never, 'snapshot-x.sqlite3', new Uint8Array(1024));
    expect(removed).toEqual([]);
    expect(files.get('snapshot-x.sqlite3')).toBe(1024);
  });
});
