import { sql } from 'drizzle-orm';
import { afterEach, expect, vi } from 'vitest';
import type { Database } from '../../src/database';
import type * as Workspaces from '../../src/repos/workspaces';
import { configureCapture } from '../../src/sync/capture';
import { afterSchemaChange, beforeSchemaChange, installCaptureTriggers, lastSealedSeq, privateLeaks, uncapturedWrites, watchGone, watchPausedWrites } from './capture-harness';

/*
 * The capture run's setup file (vitest.capture.config.ts, `npm run test:capture`; spec §6.4). The first workspace each
 * database creates has its Personal book marked shared, and §6.4's triggers watch it; after every test, any write to a
 * row of that book that no outbox op accounts for fails the test. The default `npm test` never loads this file.
 */

const watched = new Map<Database, string>();
/** Per database, the last change-set the privacy check judged: each is judged once, after the test that sealed it. */
const judgedSeq = new Map<Database, number>();

/*
 * Tests whose premise is a first Personal book that is *not* shared, which the stand-in share would contradict (G8): a
 * refusal checked before the one about sharing, a database stopped before a migration no shared book can be on, a
 * legacy unfiled transfer read the way only an unshared workspace reads it. Their books are left unshared, and
 * unwatched; everything else in their files is watched as usual. Each by its file and its test's full name.
 */
const UNSHARED_PREMISE: readonly [file: string, test: string][] = [
  ['test/bill-currency.test.ts', 'a database stopped before 0098 still saves, lists and pays a bill; the currency is simply not there'],
  ['test/books-kind.test.ts', 'changing a workspace’s kind refuses shared, an unknown workspace, and the only Personal'],
  ['test/category-set-copy.test.ts', 'copying a category set into another workspace refuses the same book, an archived book and a book that is not here, copying nothing'],
  ['test/category-set-move.test.ts', 'moving a category set to another workspace refuses the same workspace, an archived one, a missing one and a missing set'],
  ['test/move-top-up-group.test.ts', 'moving a top-up with its fee reunites a group already split across workspaces, from either half'],
];

function unsharedPremise(): boolean {
  const { testPath, currentTestName } = expect.getState();
  if (!testPath || !currentTestName) return false;
  const name = currentTestName.replace(/ > /g, ' ');
  return UNSHARED_PREMISE.some(([file, test]) => testPath.endsWith(file) && name === test);
}

async function shareFirstBook(database: Database, workspaceId: string): Promise<void> {
  if (watched.has(database)) return;
  if (unsharedPremise()) return;
  const tables = await database.db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_books'`);
  if (tables.length === 0) return; // a database stopped before 0056 has nothing to share
  const [book] = await database.db.values<[string]>(sql`SELECT id FROM books WHERE workspace_id = ${workspaceId} AND kind = 'personal'`);
  if (!book) return;
  const bookId = book[0];
  // The harness has no engine: the stand-in device id is allowed here, and nowhere in the app (final review, I3).
  configureCapture(database, { standInDeviceId: true });
  await database.db.run(
    sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${`relay-${bookId}`}, 1, 'member-harness', 'active', ${new Date().toISOString()})`,
  );
  await installCaptureTriggers(database, bookId);
  // Apply's writes (§7.2) are what another device already emitted: they are marked, and only they leave the watch;
  // the change-set they apply joins the ops a later local write is judged against.
  watchPausedWrites(database);
  watched.set(database, bookId);
  // A test's own raw SQL (a fixture: "archive this row", "age this date") is not a repository write: what it writes
  // is dropped from the watch. No repository writes data through execScript; only migrations use it.
  // One that changes a watched table's columns (an older build simulated) has the table's triggers made again around it.
  const execScript = database.execScript.bind(database);
  database.execScript = async (script: string) => {
    const [mark] = await database.db.values<[number]>(sql`SELECT coalesce(max(seq), 0) FROM temp.__writes`).catch(() => [[0] as [number]]);
    const altered = await beforeSchemaChange(database, script);
    await execScript(script);
    await afterSchemaChange(database, bookId, altered);
    await database.db.run(sql`DELETE FROM temp.__writes WHERE seq > ${mark?.[0] ?? 0}`).catch(() => undefined);
  };
}

vi.mock('../../src/repos/workspaces', async (importOriginal) => {
  const real = await importOriginal<typeof Workspaces>();
  return {
    ...real,
    createWorkspace: async (database: Database, input: Parameters<typeof real.createWorkspace>[1]) => {
      const ws = await real.createWorkspace(database, input);
      await shareFirstBook(database, ws.workspaceId);
      return ws;
    },
  };
});

afterEach(async () => {
  const misses: string[] = [];
  const leaks: string[] = [];
  const failures: unknown[] = [];
  for (const [database, bookId] of watched) {
    try {
      misses.push(...(await uncapturedWrites(database, bookId)));
      leaks.push(...(await privateLeaks(database, judgedSeq.get(database) ?? 0)));
      judgedSeq.set(database, await lastSealedSeq(database));
    } catch (error) {
      // Closed, or restored into a new connection: nothing left to watch. Any other error is a check that failed, and
      // fails this test (wave 3 merge: never swallowed); the database leaves the watch so it fails no later test.
      watched.delete(database);
      judgedSeq.delete(database);
      if (!watchGone(error)) failures.push(error);
    }
  }
  if (failures.length) throw failures[0];
  if (misses.length) throw new Error(`Writes to the shared book that capture missed (spec §6.4):\n  ${misses.join('\n  ')}`);
  // Joint net worth §10 (task 6): nothing private leaves the phone, in any outbox.
  if (leaks.length) throw new Error(`Private ids in an outbox (joint-net-worth §10):\n  ${leaks.join('\n  ')}`);
});
