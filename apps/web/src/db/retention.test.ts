import { createDatabase } from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copiesToRemove, copyName, parseName } from '../features/backup/icloud/names';
import { isKeptCopy, KEEP_OLDER_COPIES, KEPT_COPIES_FILE, KEPT_HEADROOM_BYTES, parseKeptCopies } from './retention';
import { type SnapshotReason, snapshotName } from './snapshot-policy';
import { memorySnapshots, SnapshotSpaceError } from './snapshots';

/*
 * Keeping the copies from before this build (src/db/retention.ts): they are never removed, new copies follow the
 * ordinary rules, and while kept copies are on the device a nearly full one skips the new copy rather than filling up.
 */

const engines: NodeExecutor[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (engines.length) engines.pop()!.close();
});

async function database(): Promise<Uint8Array> {
  const engine = createNodeExecutor();
  engines.push(engine);
  const db = createDatabase(engine);
  await db.execScript('CREATE TABLE t (x BLOB); INSERT INTO t VALUES (zeroblob(0));');
  return db.exportBytes();
}

/** The safety folder as an older build left it: copies of several kinds, one of them never written whole. */
function olderFolder(bytes: Uint8Array): { files: Map<string, Uint8Array>; older: string[] } {
  const files = new Map<string, Uint8Array>();
  const at = (iso: string, reason: SnapshotReason, content: Uint8Array = bytes) => {
    const file = snapshotName(iso, 107, reason);
    files.set(file, content.slice());
    return file;
  };
  const older = [
    at('2026-10-20T03:00:00.000Z', 'before-migration'),
    at('2026-10-28T03:00:00.000Z', 'daily'),
    at('2026-10-29T03:00:00.000Z', 'before-restore'),
    at('2026-10-29T05:00:00.000Z', 'background'),
    at('2026-10-30T03:00:00.000Z', 'daily', new Uint8Array(0)),
  ];
  files.set('last-failure.json', new TextEncoder().encode('[]'));
  return { files, older };
}

const at = <T>(iso: string, run: () => Promise<T>): Promise<T> => {
  vi.setSystemTime(new Date(iso));
  return run();
};

describe('the copies from before this build', () => {
  it('are kept in this build', () => {
    expect(KEEP_OLDER_COPIES).toBe(true);
  });

  it('are never removed, broken ones included, while new copies are pruned by the ordinary rules', async () => {
    const bytes = await database();
    const { files, older } = olderFolder(bytes);
    const store = memorySnapshots(files);
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const written: { file: string; reason: SnapshotReason }[] = [];
    for (let day = 1; day <= 9; day += 1) {
      const date = `2026-11-${String(day).padStart(2, '0')}`;
      written.push({ file: (await at(`${date}T02:00:00.000Z`, () => store.write(bytes, 'daily', 109))).file, reason: 'daily' });
      for (const hour of ['04', '06', '08']) {
        written.push({ file: (await at(`${date}T${hour}:00:00.000Z`, () => store.write(bytes, 'background', 109))).file, reason: 'background' });
      }
    }

    // Every older copy is still there, byte for byte, the broken one too.
    for (const file of older) expect(files.has(file)).toBe(true);
    expect(files.get(older[4]!)!.length).toBe(0);
    // Of the new ones, the ordinary rules: the two newest regular copies and the newest background copy.
    const newOnDisk = [...files.keys()].filter((file) => written.some((copy) => copy.file === file)).sort();
    const daily = written.filter((copy) => copy.reason === 'daily').map((copy) => copy.file);
    const background = written.filter((copy) => copy.reason === 'background').map((copy) => copy.file);
    expect(newOnDisk).toEqual([...daily.slice(-2), background.at(-1)!].sort());

    // The record was made once, before the first new copy, and names exactly the older copies.
    const record = parseKeptCopies(files.get(KEPT_COPIES_FILE)!)!;
    expect(record.files.sort()).toEqual([...older].sort());
    expect(record.recordedAt).toBe('2026-11-01T02:00:00.000Z');
    // The list offers them all, older and kept new ones; the broken one is not listed.
    expect((await store.list()).length).toBe(older.length - 1 + 3);
  });

  it('keeps every copy when the record cannot be read, and never writes over it', async () => {
    const bytes = await database();
    const { files, older } = olderFolder(bytes);
    files.set(KEPT_COPIES_FILE, new TextEncoder().encode('{torn'));
    const store = memorySnapshots(files);
    vi.useFakeTimers();
    const first = await at('2026-11-01T02:00:00.000Z', () => store.write(bytes, 'daily', 109));
    const second = await at('2026-11-02T02:00:00.000Z', () => store.write(bytes, 'daily', 109));
    const third = await at('2026-11-03T02:00:00.000Z', () => store.write(bytes, 'daily', 109));
    for (const file of [...older, first.file, second.file, third.file]) expect(files.has(file)).toBe(true);
    expect(new TextDecoder().decode(files.get(KEPT_COPIES_FILE)!)).toBe('{torn');
  });

  it('keeps a copy named in the record, and one taken before it whose name the record lacks', () => {
    const record = { recordedAt: '2026-11-01T02:00:00.500Z', files: [snapshotName('2027-01-01T00:00:00.000Z', 107, 'daily')] };
    // Named: kept, whatever its time says (a clock that was ahead).
    expect(isKeptCopy(record, { file: record.files[0]!, takenAt: '2027-01-01T00:00:00.000Z' })).toBe(true);
    // Not named, but older: kept.
    expect(isKeptCopy(record, { file: 'other', takenAt: '2026-10-31T23:59:59.000Z' })).toBe(true);
    // The copy taken in the record's own second is this build's.
    expect(isKeptCopy(record, { file: 'mine', takenAt: '2026-11-01T02:00:00.000Z' })).toBe(false);
    expect(isKeptCopy(record, { takenAt: '2026-11-02T00:00:00.000Z' })).toBe(false);
    expect(isKeptCopy(null, { takenAt: '2026-11-02T00:00:00.000Z' })).toBe(true);
  });
});

describe('a nearly full device, while older copies are kept', () => {
  it('skips the copy where there is room for one more but not three, says so, and writes nothing', async () => {
    const bytes = await database();
    const { files, older } = olderFolder(bytes);
    const skipped: SnapshotReason[] = [];
    // Room for two copies: enough for the ordinary rules' "write one, prune the rest", but not with copies kept.
    const free = { quota: 1_000_000_000, usage: 1_000_000_000 - KEPT_HEADROOM_BYTES - bytes.length * 2 };
    const store = memorySnapshots(files, async () => free, { onSkipped: (reason) => skipped.push(reason) });
    const before = [...files.keys()].filter((file) => file !== KEPT_COPIES_FILE).sort();
    vi.useFakeTimers();
    await expect(at('2026-11-01T02:00:00.000Z', () => store.write(bytes, 'background', 109))).rejects.toThrow(SnapshotSpaceError);
    await expect(at('2026-11-01T03:00:00.000Z', () => store.write(bytes, 'daily', 109))).rejects.toThrow(/beside the older copies being kept/);
    expect(skipped).toEqual(['background', 'daily']);
    expect([...files.keys()].filter((file) => file !== KEPT_COPIES_FILE).sort()).toEqual(before);
    for (const file of older) expect(files.has(file)).toBe(true);
  });

  it('keeps the headroom free: three copies of room is not enough without it', async () => {
    const bytes = await database();
    const { files } = olderFolder(bytes);
    const tight = { quota: 1_000_000_000, usage: 1_000_000_000 - bytes.length * 3 - KEPT_HEADROOM_BYTES + 1 };
    await expect(memorySnapshots(files, async () => tight).write(bytes, 'daily', 109)).rejects.toThrow(SnapshotSpaceError);
    const roomy = { quota: 1_000_000_000, usage: 1_000_000_000 - bytes.length * 3 - KEPT_HEADROOM_BYTES };
    await expect(memorySnapshots(files, async () => roomy).write(bytes, 'daily', 109)).resolves.toMatchObject({ reason: 'daily' });
  });

  it('writes as before on a device with no older copies: room for one is still a copy, pruned down to one', async () => {
    const bytes = await database();
    const files = new Map<string, Uint8Array>();
    let free = { quota: 1_000_000_000, usage: 0 };
    const store = memorySnapshots(files, async () => free);
    vi.useFakeTimers();
    await at('2026-11-01T02:00:00.000Z', () => store.write(bytes, 'daily', 109));
    await at('2026-11-02T02:00:00.000Z', () => store.write(bytes, 'daily', 109));
    free = { quota: 1_000_000_000, usage: 1_000_000_000 - bytes.length * 2 };
    const last = await at('2026-11-03T02:00:00.000Z', () => store.write(bytes, 'daily', 109));
    expect((await store.list()).map((copy) => copy.file)).toEqual([last.file]);
  });
});

describe('iCloud copies from before this build', () => {
  const device = '1A2B3C4D-0000-4000-8000-000000000001';
  const copy = (iso: string) => parseName(copyName({ takenAt: iso, model: 'iPhone', device, withPhotos: false, bytes: 10 }))!;

  it('are never named for removal; newer copies follow the 7-day rule over themselves alone', () => {
    const older = Array.from({ length: 20 }, (_, i) => copy(new Date(Date.UTC(2026, 9, 1 + i, 5)).toISOString()));
    const newer = Array.from({ length: 10 }, (_, i) => copy(new Date(Date.UTC(2026, 10, 1 + i, 5)).toISOString()));
    const record = { recordedAt: '2026-10-31T00:00:00.000Z', files: [] };
    const removed = copiesToRemove([...older, ...newer], device, record);
    expect(removed.some((name) => older.some((old) => old.name === name))).toBe(false);
    // Ten new backup days: the three oldest of them go.
    expect(removed.sort()).toEqual(newer.slice(0, 3).map((c) => c.name).sort());
    // A record that cannot be read removes nothing; no record at all is the rule as it always was.
    expect(copiesToRemove([...older, ...newer], device, null)).toEqual([]);
    expect(copiesToRemove([...older, ...newer], device).length).toBe(23);
  });
});
