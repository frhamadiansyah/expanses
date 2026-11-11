import { createDatabase } from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copiesToRemove, copyName, parseName } from '../features/backup/icloud/names';
import { PRUNING_PAUSED } from './retention';
import { memorySnapshots } from './snapshots';

/*
 * The pause on removing old copies (src/db/retention.ts): with it on, as this build ships, a copy written removes
 * nothing already on the device, and the iCloud rule names nothing to remove.
 */

const engines: NodeExecutor[] = [];
afterEach(() => {
  vi.useRealTimers();
  while (engines.length) engines.pop()!.close();
});

async function database(): Promise<Uint8Array> {
  const engine = createNodeExecutor();
  engines.push(engine);
  const db = createDatabase(engine);
  await db.execScript('CREATE TABLE t (x BLOB); INSERT INTO t VALUES (zeroblob(0));');
  return db.exportBytes();
}

describe('pruning, paused', () => {
  it('is paused in this build', () => {
    expect(PRUNING_PAUSED).toBe(true);
  });

  it('names no iCloud copy to remove, however many and however old', () => {
    const device = '1A2B3C4D-0000-4000-8000-000000000001';
    const copies = Array.from({ length: 40 }, (_, i) => parseName(copyName({ takenAt: new Date(Date.UTC(2026, 8, 1 + i, 5)).toISOString(), model: 'iPhone', device, withPhotos: false, bytes: 10 }))!);
    expect(copiesToRemove(copies, device)).toEqual([]);
    // The rule itself is still there for when the pause is lifted.
    expect(copiesToRemove(copies, device, false).length).toBeGreaterThan(0);
  });

  it('keeps every local copy a write would have pruned, broken ones too, and still writes the new one', async () => {
    const bytes = await database();
    const files = new Map<string, Uint8Array>();
    const store = memorySnapshots(files);
    vi.useFakeTimers();
    const written: string[] = [];
    for (let day = 1; day <= 6; day += 1) {
      vi.setSystemTime(new Date(`2026-10-0${day}T10:00:00.000Z`));
      written.push((await store.write(bytes, day % 2 ? 'daily' : 'background', 108)).file);
    }
    files.set('snapshot-2026-09-01T00-00-00-000Z-v108-daily.sqlite3', new Uint8Array(0));
    vi.setSystemTime(new Date('2026-10-07T10:00:00.000Z'));
    written.push((await store.write(bytes, 'daily', 108)).file);
    vi.useRealTimers();
    expect((await store.list()).map((copy) => copy.file).sort()).toEqual([...written].sort());
    expect(files.has('snapshot-2026-09-01T00-00-00-000Z-v108-daily.sqlite3')).toBe(true);

    // With pruning on, the same writes keep two.
    const pruned = memorySnapshots(new Map(), undefined, { pruning: true });
    vi.useFakeTimers();
    for (let day = 1; day <= 4; day += 1) {
      vi.setSystemTime(new Date(`2026-10-0${day}T10:00:00.000Z`));
      await pruned.write(bytes, 'daily', 108);
    }
    vi.useRealTimers();
    expect(await pruned.list()).toHaveLength(2);
  });
});
