import { createDatabase } from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastGoodCopy } from '../features/recovery/recovery-copy';
import { dailyDue, type SnapshotInfo, snapshotName } from './snapshot-policy';
import { IMPORT_MARKER, MANIFEST, memorySnapshots, restoreSnapshot, SnapshotSpaceError, writeWhole } from './snapshots';

// These tests hold the retention rules themselves; keeping the older copies (src/db/retention.ts) has its own test.
vi.mock('./retention', async (importOriginal) => ({ ...(await importOriginal<typeof import('./retention')>()), KEEP_OLDER_COPIES: false }));

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

describe('a restore that is cut off half way', () => {
  async function storeWithCopy() {
    const bytes = await database();
    const files = new Map<string, Uint8Array>();
    const store = memorySnapshots(files);
    const copy = await at('2026-09-15T10:00:00.000Z', () => store.write(bytes, 'daily', 108));
    return { bytes, files, store, copy };
  }

  it('leaves a note naming the copy of what it replaced while it writes, and removes it once done', async () => {
    const { bytes, store, copy } = await storeWithCopy();
    let during: unknown = 'not asked';
    await restoreSnapshot({
      snapshots: store,
      file: copy.file,
      source: 'recovery screen',
      live: async () => bytes,
      restore: async () => {
        during = await store.importMarker!();
      },
    });
    const before = (await store.list()).find((s) => s.reason === 'before-restore');
    expect(before).toBeDefined();
    expect(during).toMatchObject({ beforeCopy: before!.file, source: 'recovery screen' });
    expect(await store.importMarker!()).toBeNull();
  });

  it('removes the note when the engine refuses the copy and puts the old bytes back itself', async () => {
    const { bytes, store, copy } = await storeWithCopy();
    await expect(
      restoreSnapshot({
        snapshots: store,
        file: copy.file,
        live: async () => bytes,
        restore: async () => {
          throw new Error('That file is not an Expanses backup.');
        },
      }),
    ).rejects.toThrow(/not an Expanses backup/);
    expect(await store.importMarker!()).toBeNull();
  });

  it('keeps the note when the write never comes back, which is what an app killed mid-restore leaves', async () => {
    const { bytes, store, copy } = await storeWithCopy();
    void restoreSnapshot({ snapshots: store, file: copy.file, live: async () => bytes, restore: () => new Promise(() => undefined) });
    await expect.poll(() => store.importMarker!()).not.toBeNull();
    // A note is not a copy: it is never listed among them.
    expect((await store.list()).every((s) => s.file.endsWith('.sqlite3'))).toBe(true);
  });

  it('reads a note that is not one as no note', async () => {
    const files = new Map<string, Uint8Array>([[IMPORT_MARKER, new TextEncoder().encode('{half')]]);
    expect(await memorySnapshots(files).importMarker!()).toBeNull();
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

  it('hands the write to the fallback writer when this thread has no createWritable', async () => {
    const removed: string[] = [];
    const dir = { getFileHandle: async () => ({}), removeEntry: async (name: string) => void removed.push(name) };
    const fallback = vi.fn(async () => undefined);
    await writeWhole(dir as never, 'snapshot-x.sqlite3', new Uint8Array(1024), fallback);
    expect(fallback).toHaveBeenCalledWith('expanses-safety', 'snapshot-x.sqlite3', expect.any(Uint8Array));
    expect(removed).toEqual([]);
  });

  it('removes the file when the fallback writer fails too', async () => {
    const removed: string[] = [];
    const dir = { getFileHandle: async () => ({}), removeEntry: async (name: string) => void removed.push(name) };
    await expect(
      writeWhole(dir as never, 'manifest.json', new Uint8Array(10), async () => {
        throw new Error('NoModificationAllowedError');
      }),
    ).rejects.toThrow('NoModificationAllowedError');
    expect(removed).toEqual(['manifest.json']);
  });

  it('never uses the fallback when createWritable is there', async () => {
    const { dir } = directory(null);
    const fallback = vi.fn(async () => undefined);
    await writeWhole(dir as never, 'snapshot-x.sqlite3', new Uint8Array(1024), fallback);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('leaves the file when every step worked', async () => {
    const { dir, files, removed } = directory(null);
    await writeWhole(dir as never, 'snapshot-x.sqlite3', new Uint8Array(1024));
    expect(removed).toEqual([]);
    expect(files.get('snapshot-x.sqlite3')).toBe(1024);
  });
});

describe('background copies in the store', () => {
  const minute = (m: number) => new Date(Date.UTC(2026, 10, 10, 9, m)).toISOString();

  it('are listed from their name alone, and never written into the manifest', async () => {
    const bytes = await database();
    const files = new Map<string, Uint8Array>();
    const store = memorySnapshots(files);
    const daily = await at(minute(0), () => store.write(bytes, 'daily', 108));
    const background = await at(minute(10), () => store.write(bytes, 'background', 108));
    const manifest = new TextDecoder().decode(files.get(MANIFEST)!);
    expect(manifest).toContain(daily.file);
    expect(manifest).not.toContain(background.file);
    expect((await store.list()).map((s) => [s.file, s.reason, s.bytes])).toEqual([
      [daily.file, 'daily', bytes.length],
      [background.file, 'background', bytes.length],
    ]);
    // Nor by the other writers of the manifest.
    await store.block(109, 109);
    await store.unblock();
    expect(new TextDecoder().decode(files.get(MANIFEST)!)).not.toContain(background.file);
  });

  it('ten in a row leave one, beside the daily and before-update copies', async () => {
    const bytes = await database();
    const store = memorySnapshots();
    const update = await at(minute(0), () => store.write(bytes, 'before-migration', 108));
    const daily = await at(minute(1), () => store.write(bytes, 'daily', 108));
    let last: SnapshotInfo | null = null;
    for (let i = 0; i < 10; i += 1) last = await at(minute(10 + i * 11), () => store.write(bytes, 'background', 108));
    const listed = await store.list();
    expect(listed.map((s) => s.file).sort()).toEqual([update.file, daily.file, last!.file].sort());
    expect(lastGoodCopy(listed)?.file).toBe(last!.file);
  });

  /**
   * iOS may suspend or kill the app while the copy is being written: nothing after the cut runs, so no clean-up
   * and no manifest update. What is left is a file under a valid background name holding nothing, or only its
   * first pages. Neither may be listed, offered or counted, and the next copy that verifies removes it.
   */
  for (const cut of ['nothing', 'the first page'] as const) {
    it(`lists nothing of a background copy cut off after ${cut} was written`, async () => {
      const bytes = await database(400_000);
      const files = new Map<string, Uint8Array>();
      const store = memorySnapshots(files);
      const daily = await at(minute(0), () => store.write(bytes, 'daily', 108));
      const torn = snapshotName(minute(10), 108, 'background');
      files.set(torn, cut === 'nothing' ? new Uint8Array() : bytes.slice(0, 4096));

      const listed = await store.list();
      expect(listed.map((s) => s.file)).toEqual([daily.file]);
      expect(lastGoodCopy(listed)?.file).toBe(daily.file);

      const next = await at(minute(30), () => store.write(bytes, 'background', 108));
      expect(files.has(torn)).toBe(false);
      expect((await store.list()).map((s) => s.file)).toEqual([daily.file, next.file]);
    });
  }

  it('on a device short of room keep only the newest copy, and with no room change nothing', async () => {
    const bytes = await database();
    let free = 100 * bytes.length;
    const files = new Map<string, Uint8Array>();
    const store = memorySnapshots(files, async () => ({ quota: 1_000_000_000, usage: 1_000_000_000 - free }));
    await at(minute(0), () => store.write(bytes, 'before-migration', 108));
    await at(minute(1), () => store.write(bytes, 'daily', 108));

    free = 0.5 * bytes.length;
    await expect(at(minute(10), () => store.write(bytes, 'background', 108))).rejects.toThrow(SnapshotSpaceError);
    expect((await store.list()).map((s) => s.reason).sort()).toEqual(['before-migration', 'daily']);

    free = 2 * bytes.length;
    const kept = await at(minute(20), () => store.write(bytes, 'background', 108));
    expect((await store.list()).map((s) => s.file)).toEqual([kept.file]);
  });
});
