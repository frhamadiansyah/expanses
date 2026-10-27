import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createBook, type Database, ensureCategoryKeys, personalBook } from '../src/index';
import { defaultCategoryIdOf } from '../src/repos/categories';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

/*
 * Platform fee under Miscellaneous: built in for a new workspace, and added once to the Miscellaneous of every open
 * book an existing workspace holds when the app opens on the new version.
 */

const KEY = 'miscellaneous.platform_fee';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function platformFeesIn(database: Database, bookId: string) {
  const rows = await database.db.values<[string, string, string | null]>(sql`
    SELECT a.id, a.name, p.system_key
      FROM accounts a
      JOIN book_categories b ON b.category_account_id = a.id
      LEFT JOIN accounts p ON p.id = a.parent_id
     WHERE b.book_id = ${bookId} AND a.subtype = 'category' AND a.system_key = ${KEY}`);
  return rows.map(([id, name, parent]) => ({ id, name, parent }));
}

/** Takes Platform fee out again, as a workspace made before it was built in held it. */
async function asBeforeTheUpgrade(database: Database): Promise<void> {
  await database.execScript(`
    DELETE FROM book_categories WHERE category_account_id IN (SELECT id FROM accounts WHERE system_key = '${KEY}');
    DELETE FROM accounts WHERE system_key = '${KEY}';`);
}

describe('Platform fee', () => {
  it('is built in under Miscellaneous for a new workspace, once, and a later open adds none', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    const made = await platformFeesIn(database, book.id);
    expect(made.map((row) => [row.name, row.parent])).toEqual([['Platform fee', 'miscellaneous']]);
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
    expect(await platformFeesIn(database, book.id)).toEqual(made);
  });

  it('is added once to every open book of a workspace from before it existed', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const personal = await personalBook(database, ws);
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    await asBeforeTheUpgrade(database);

    const result = await ensureCategoryKeys(database, ws);
    expect(result.created.filter((key) => key === KEY)).toHaveLength(2);
    for (const bookId of [personal.id, business]) {
      const made = await platformFeesIn(database, bookId);
      expect(made.map((row) => [row.id, row.name, row.parent])).toEqual([[await defaultCategoryIdOf(bookId, KEY), 'Platform fee', 'miscellaneous']]);
    }
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
    expect(await platformFeesIn(database, personal.id)).toHaveLength(1);
  });
});
