import { createDatabase, type Database, migrate } from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKGROUND_COPY_EVERY_MS, backgroundCopier, type LeaveSignals, watchLeaving } from './background-copy';
import { type CheckedSnapshot, liveProblem } from './live-health';
import type { Safety } from './open';
import { memorySnapshots } from './snapshots';

// These tests hold the retention rules themselves; the pause on them (src/db/retention.ts) has its own test.
vi.mock('./retention', () => ({ PRUNING_PAUSED: false }));

const engines: NodeExecutor[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (engines.length) engines.pop()!.close();
});

async function live(): Promise<Database> {
  const engine = createNodeExecutor();
  engines.push(engine);
  const database = createDatabase(engine);
  await migrate(database, [{ version: 1, name: 'ledger', sql: 'CREATE TABLE ledger (amount INTEGER);' }]);
  return database;
}

/**
 * The worker's `checked-snapshot` op, over a Node database: the same count, the same two questions through
 * the same `liveProblem`, the same bytes. `structure` stands in for a `quick_check` that answers otherwise.
 */
function checkedOver(database: Database, structure?: () => string) {
  return async (since: number): Promise<CheckedSnapshot> => {
    const changes = Number((await database.db.values<[number]>(sql`SELECT total_changes()`))[0]![0]);
    if (changes === since) return { changes, bytes: null };
    const tables = Number((await database.db.values<[number]>(sql`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`))[0]![0]);
    const answer = structure?.() ?? String((await database.db.values<[string]>(sql`PRAGMA quick_check(1)`))[0]![0]);
    const problem = liveProblem({ hasSchema: tables > 0, structure: answer });
    if (problem) throw new Error(`No copy was taken: ${problem}`);
    return { changes, bytes: await database.exportBytes() };
  };
}

async function setUp(structure?: () => string) {
  const database = await live();
  const snapshots = memorySnapshots();
  let clock = Date.UTC(2026, 10, 10, 9);
  const safety: Safety & Required<Pick<Safety, 'checked'>> = {
    snapshots,
    bytes: () => database.exportBytes(),
    checked: checkedOver(database, structure),
    schemaVersion: 1,
  };
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const copy = backgroundCopier(safety, () => clock);
  const pass = (ms: number) => {
    clock += ms;
  };
  const write = () => database.execScript('INSERT INTO ledger VALUES (1)');
  return { database, snapshots, copy, pass, write };
}

describe('the copy taken on leaving the app', () => {
  it('is taken when something was written, and labelled background', async () => {
    const { snapshots, copy } = await setUp();
    // The open itself wrote (the migration recorded its version), and that counts: the connection opened at 0.
    expect(await copy()).toBe('taken');
    const listed = await snapshots.list();
    expect(listed.map((s) => [s.reason, s.schemaVersion])).toEqual([['background', 1]]);
  });

  it('is not taken when nothing has changed since the last one, however long ago it was', async () => {
    const { snapshots, copy, pass } = await setUp();
    expect(await copy()).toBe('taken');
    pass(BACKGROUND_COPY_EVERY_MS * 3);
    expect(await copy()).toBe('unchanged');
    expect(await snapshots.list()).toHaveLength(1);
  });

  it('is taken at most once every ten minutes, and again once they have passed', async () => {
    const { snapshots, copy, pass, write } = await setUp();
    expect(await copy()).toBe('taken');
    const first = (await snapshots.list())[0]!;
    await write();
    pass(BACKGROUND_COPY_EVERY_MS - 1000);
    expect(await copy()).toBe('too-soon');
    pass(2000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 10, 9, 11)));
    expect(await copy()).toBe('taken');
    vi.useRealTimers();
    // Still one: the newer replaces the older.
    const listed = await snapshots.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.file).not.toBe(first.file);
  });

  it('never runs two at once: a second leave while one is writing is the same attempt', async () => {
    const { copy } = await setUp();
    const [a, b] = await Promise.all([copy(), copy()]);
    expect([a, b]).toEqual(['taken', 'in-flight']);
  });

  it('skips a file that does not pass quick_check, takes nothing, and does not check again at once', async () => {
    const quick = vi.fn(() => '*** in database main *** Page 3: btreeInitPage() returns error code 11');
    const { snapshots, copy, pass, write } = await setUp(quick);
    expect(await copy()).toBe('failed');
    expect(await snapshots.list()).toEqual([]);
    await write();
    pass(60_000);
    expect(await copy()).toBe('too-soon');
    expect(quick).toHaveBeenCalledTimes(1);
  });

  it('skips a file with no schema_migrations in it', async () => {
    const { database, snapshots, copy } = await setUp();
    await database.execScript('DROP TABLE schema_migrations');
    expect(await copy()).toBe('failed');
    expect(await snapshots.list()).toEqual([]);
  });

  it('never throws, whatever goes wrong', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const copy = backgroundCopier({
      snapshots: memorySnapshots(),
      bytes: async () => new Uint8Array(),
      checked: async () => {
        throw new Error('The database engine is gone');
      },
      schemaVersion: 1,
    });
    await expect(copy()).resolves.toBe('failed');
  });
});

describe('liveProblem', () => {
  it('passes only a file with schema_migrations that answered ok', () => {
    expect(liveProblem({ hasSchema: true, structure: 'ok' })).toBeNull();
    expect(liveProblem({ hasSchema: false, structure: 'ok' })).toMatch(/schema_migrations/);
    expect(liveProblem({ hasSchema: true, structure: 'row 4 missing from index' })).toMatch(/row 4 missing/);
    expect(liveProblem({ hasSchema: true, structure: null })).not.toBeNull();
  });
});

describe('watchLeaving', () => {
  /** A document, a window and a Capacitor shell that the test fires by hand. */
  function signals() {
    const doc = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    doc.visibilityState = 'visible';
    const win = Object.assign(new EventTarget(), { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    const shellListeners: Record<string, (() => void)[]> = { pause: [], resume: [] };
    const removed: string[] = [];
    const shell = {
      addListener: async (event: 'pause' | 'resume', listener: () => void) => {
        shellListeners[event]!.push(listener);
        return { remove: async () => void removed.push(event) };
      },
    };
    const hide = () => {
      doc.visibilityState = 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
    };
    const show = () => {
      doc.visibilityState = 'visible';
      doc.dispatchEvent(new Event('visibilitychange'));
    };
    const fire = (event: 'pause' | 'resume') => shellListeners[event]!.forEach((listener) => listener());
    return { given: { document: doc, window: win, shell } as unknown as LeaveSignals, win, hide, show, fire, removed };
  }

  it('makes one attempt per leave, however many signals the leave sends', async () => {
    vi.useFakeTimers();
    const { given, hide, show, fire } = signals();
    const onLeave = vi.fn();
    watchLeaving(onLeave, given);

    // The native pause and the web view's own visibilitychange are the same trip to the background.
    fire('pause');
    hide();
    fire('pause');
    await vi.runAllTimersAsync();
    expect(onLeave).toHaveBeenCalledTimes(1);

    // Back, and away again: a second leave, a second attempt.
    fire('resume');
    show();
    hide();
    await vi.runAllTimersAsync();
    expect(onLeave).toHaveBeenCalledTimes(2);
  });

  it('takes no copy for a page that is being unloaded or put into the back-forward cache', async () => {
    vi.useFakeTimers();
    const { given, hide, win } = signals();
    const onLeave = vi.fn();
    watchLeaving(onLeave, given);
    // An unloading document fires visibilitychange to hidden and then pagehide, in the same task.
    hide();
    win.dispatchEvent(new Event('pagehide'));
    await vi.runAllTimersAsync();
    expect(onLeave).not.toHaveBeenCalled();
    // And coming back out of the cache is a return, after which a real leave counts again.
    win.dispatchEvent(new Event('pageshow'));
    hide();
    await vi.runAllTimersAsync();
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('stops listening when asked', async () => {
    vi.useFakeTimers();
    const { given, hide, fire, removed } = signals();
    const onLeave = vi.fn();
    const stop = watchLeaving(onLeave, given);
    stop();
    hide();
    fire('pause');
    await vi.runAllTimersAsync();
    expect(onLeave).not.toHaveBeenCalled();
    expect(removed.sort()).toEqual(['pause', 'resume']);
  });
});
