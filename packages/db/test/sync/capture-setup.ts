import { sql } from 'drizzle-orm';
import { afterEach, vi } from 'vitest';
import type { Database } from '../../src/database';
import type * as Workspaces from '../../src/repos/workspaces';
import { configureCapture } from '../../src/sync/capture';
import { installCaptureTriggers, privateLeaks, uncapturedWrites, watchPausedWrites } from './capture-harness';

/*
 * The capture run's setup file (vitest.capture.config.ts, `npm run test:capture`; spec §6.4). The first workspace each
 * database creates has its Personal book marked shared, and §6.4's triggers watch it; after every test, any write to a
 * row of that book that no outbox op accounts for fails the test. The default `npm test` never loads this file.
 */

const watched = new Map<Database, string>();

async function shareFirstBook(database: Database, workspaceId: string): Promise<void> {
  if (watched.has(database)) return;
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
  const execScript = database.execScript.bind(database);
  database.execScript = async (script: string) => {
    const [mark] = await database.db.values<[number]>(sql`SELECT coalesce(max(seq), 0) FROM temp.__writes`).catch(() => [[0] as [number]]);
    await execScript(script);
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
  for (const [database, bookId] of watched) {
    try {
      misses.push(...(await uncapturedWrites(database, bookId)));
      leaks.push(...(await privateLeaks(database)));
    } catch {
      watched.delete(database); // closed, or restored into a new connection: nothing left to watch
    }
  }
  if (misses.length) throw new Error(`Writes to the shared book that capture missed (spec §6.4):\n  ${misses.join('\n  ')}`);
  // Joint net worth §10 (task 6): nothing private leaves the phone, in any outbox.
  if (leaks.length) throw new Error(`Private ids in an outbox (joint-net-worth §10):\n  ${leaks.join('\n  ')}`);
});
