import { describe, expect, it } from 'vitest';
import { appendEntry, type FailureEntry, formatFailureLog, parseFailureLog, recordFailure, surveySlots } from './failure-log';
import type { RecoveryReason } from './open';

const entry = (at: string): FailureEntry => ({
  at,
  kind: 'corrupt',
  detail: 'database disk image is malformed',
  midSession: false,
  build: '0.5.0 (57)',
  latestVersion: 108,
  slots: [],
  copies: [],
});

const MAGIC = new TextEncoder().encode('SQLite format 3\0');

/** A file of `size` bytes, with the SQLite magic at 4096 when `sqlite`. */
function file(name: string, size: number, sqlite: boolean) {
  const bytes = new Uint8Array(size);
  if (sqlite) bytes.set(MAGIC, 4096);
  return {
    kind: 'file' as const,
    name,
    getFile: async () => ({ size, slice: (from: number, to: number) => ({ arrayBuffer: async () => bytes.slice(from, to).buffer }) }),
  };
}
function folder(name: string, entries: unknown[]) {
  return {
    kind: 'directory' as const,
    name,
    async *values() {
      yield* entries;
    },
  };
}

describe('the record of a failure', () => {
  it('keeps the five newest, newest first', () => {
    let log: FailureEntry[] = [];
    for (let day = 1; day <= 7; day += 1) log = appendEntry(log, entry(`2026-10-0${day}T00:00:00.000Z`));
    expect(log.map((e) => e.at.slice(8, 10))).toEqual(['07', '06', '05', '04', '03']);
  });

  it('reads a log that is missing or broken as an empty one', () => {
    expect(parseFailureLog(null)).toEqual([]);
    expect(parseFailureLog(new TextEncoder().encode('{nope'))).toEqual([]);
    expect(parseFailureLog(new TextEncoder().encode(JSON.stringify([entry('2026-10-01T00:00:00.000Z'), { junk: 1 }])))).toHaveLength(1);
  });

  it('surveys every slot file: its size and whether a database starts after the pool header', async () => {
    const root = {
      getDirectoryHandle: async () => folder('.expanses', [folder('.opaque', [file('a', 8192, true), file('b', 4096, false), file('c', 0, false)])]),
    };
    expect(await surveySlots(root)).toEqual([
      { path: '.opaque/a', bytes: 8192, sqlite: true },
      { path: '.opaque/b', bytes: 4096, sqlite: false },
      { path: '.opaque/c', bytes: 0, sqlite: false },
    ]);
    expect(await surveySlots({ getDirectoryHandle: async () => Promise.reject(new Error('NotFoundError')) })).toEqual([]);
  });

  it('writes the reason, the build, the slots and the copies, and hands back the whole log', async () => {
    let stored: Uint8Array | null = new TextEncoder().encode(JSON.stringify([entry('2026-10-01T00:00:00.000Z')]));
    const reason: RecoveryReason = { kind: 'unreadable', headline: 'x', detail: 'NoModificationAllowedError: held', exportable: true, held: true };
    const log = await recordFailure(reason, {
      now: () => new Date('2026-10-31T08:00:00.000Z'),
      build: async () => '0.5.0 (57)',
      slots: async () => [{ path: '.opaque/a', bytes: 8192, sqlite: true }],
      copies: async () => [{ file: 'snapshot-x.sqlite3', bytes: 0, reason: 'daily', schemaVersion: 108, takenAt: 'x' }],
      read: async () => stored,
      write: async (bytes) => {
        stored = bytes;
      },
    });
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      at: '2026-10-31T08:00:00.000Z',
      kind: 'unreadable',
      detail: 'NoModificationAllowedError: held',
      midSession: false,
      build: '0.5.0 (57)',
      slots: [{ path: '.opaque/a', bytes: 8192, sqlite: true }],
      copies: [{ file: 'snapshot-x.sqlite3', bytes: 0 }],
    });
    expect(parseFailureLog(stored)).toEqual(log);
  });

  it('never throws, whatever will not answer', async () => {
    const boom = async () => {
      throw new Error('no storage');
    };
    const reason: RecoveryReason = { kind: 'corrupt', headline: 'x', detail: 'y', exportable: true, midSession: true };
    const log = await recordFailure(reason, { now: () => new Date('2026-10-31T08:00:00.000Z'), build: boom, slots: boom, copies: boom, read: boom, write: boom });
    expect(log[0]).toMatchObject({ kind: 'corrupt', midSession: true, build: null, slots: [], copies: [] });
  });

  it('reads as plain text a person can copy into a message', () => {
    const text = formatFailureLog([{ ...entry('2026-10-31T08:00:00.000Z'), slots: [{ path: '.opaque/a', bytes: 8192, sqlite: true }], copies: [{ file: 'snapshot-x.sqlite3', bytes: 0 }] }]);
    expect(text).toContain('2026-10-31T08:00:00.000Z · corrupt');
    expect(text).toContain('database disk image is malformed');
    expect(text).toContain('.opaque/a 8192 bytes, SQLite');
    expect(text).toContain('snapshot-x.sqlite3 0 bytes');
    expect(text).not.toMatch(/\byou(r)?\b/i);
  });
});
