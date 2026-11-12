import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { type Database, ensureCategoryKeys, personalBook } from '../src/index';
import { defaultCategoryIdOf } from '../src/repos/categories';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

/*
 * Early childhood and Development fees under Education: built in for a new workspace, and added once — last among
 * Education's children, in that order — to the Education of every book an existing workspace holds when the app opens
 * on the new version.
 */

const KEYS = ['education.early_childhood', 'education.development_fees'];
const NAMES = ['Early childhood', 'Development fees'];

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

type Row = { id: string; key: string | null; name: string; parent: string | null; sortOrder: number };

async function educationChildren(database: Database, bookId: string): Promise<Row[]> {
  const rows = await database.db.values<[string, string | null, string, string | null, number]>(sql`
    SELECT a.id, a.system_key, a.name, p.system_key, a.sort_order
      FROM accounts a
      JOIN book_categories b ON b.category_account_id = a.id
      JOIN accounts p ON p.id = a.parent_id
     WHERE b.book_id = ${bookId} AND a.subtype = 'category' AND p.system_key = 'education'
     ORDER BY a.sort_order`);
  return rows.map(([id, key, name, parent, sortOrder]) => ({ id, key, name, parent, sortOrder: Number(sortOrder) }));
}

const isNew = (row: Row) => row.key !== null && KEYS.includes(row.key);

/** Takes both out again, as a workspace made before they were built in held it. */
async function asBeforeTheUpgrade(database: Database): Promise<void> {
  const keys = KEYS.map((key) => `'${key}'`).join(', ');
  await database.execScript(`
    DELETE FROM book_categories WHERE category_account_id IN (SELECT id FROM accounts WHERE system_key IN (${keys}));
    DELETE FROM accounts WHERE system_key IN (${keys});`);
}

describe('Early childhood and Development fees', () => {
  it('are built in as the last children of Education for a new workspace, once', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    const children = await educationChildren(database, book.id);
    expect(children.filter(isNew).map((row) => row.name)).toEqual(NAMES);
    expect(children.slice(-2).map((row) => row.key)).toEqual(KEYS);
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
  });

  it('are added once, last under Education, to a workspace from before they were built in, under ids worked out from the book', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    expect((await educationChildren(database, book.id)).some(isNew)).toBe(false);

    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: KEYS });
    const children = await educationChildren(database, book.id);
    expect(children.filter(isNew).map((row) => [row.id, row.name])).toEqual([
      [await defaultCategoryIdOf(book.id, KEYS[0]!), NAMES[0]],
      [await defaultCategoryIdOf(book.id, KEYS[1]!), NAMES[1]],
    ]);
    expect(children.slice(-2).map((row) => row.key)).toEqual(KEYS);

    // The app opens every day: nothing more is made.
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
    expect(await educationChildren(database, book.id)).toEqual(children);
  });

  it('are not added under an Education that was put away', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    await database.execScript(`UPDATE accounts SET archived_at = '2026-10-01T00:00:00.000Z' WHERE system_key = 'education'`);

    expect((await ensureCategoryKeys(database, ws)).created).toEqual([]);
    expect((await educationChildren(database, book.id)).some(isNew)).toBe(false);
  });
});
