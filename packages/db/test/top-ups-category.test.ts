import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccount,
  createCardAccount,
  type Database,
  ensureCategoryKeys,
  moveMoneyIn,
  personalBook,
  topUpsCategory,
} from '../src/index';
import { defaultCategoryIdOf } from '../src/repos/categories';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

/*
 * Top-ups under Miscellaneous: built in for a new workspace, and added once to the Miscellaneous of every book an
 * existing workspace holds when the app opens on the new version — never on top of the Top-ups a card's top-up of a
 * wallet already made there on first need, when it was not yet a default.
 */

const KEY = 'miscellaneous.top_ups';
const ARCHIVED = "'2026-10-01T00:00:00.000Z'";

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

type Row = { id: string; key: string | null; name: string; parent: string | null };

async function categoriesOf(database: Database, bookId: string): Promise<Row[]> {
  const rows = await database.db.values<[string, string | null, string, string | null]>(sql`
    SELECT a.id, a.system_key, a.name, p.system_key
      FROM accounts a
      JOIN book_categories b ON b.category_account_id = a.id
      LEFT JOIN accounts p ON p.id = a.parent_id
     WHERE b.book_id = ${bookId} AND a.subtype = 'category'`);
  return rows.map(([id, key, name, parent]) => ({ id, key, name, parent }));
}

const topUpsIn = async (database: Database, bookId: string) => (await categoriesOf(database, bookId)).filter((row) => row.key === KEY);

/** Takes Top-ups out again, as a workspace made before it was built in held it. */
async function asBeforeTheUpgrade(database: Database): Promise<void> {
  await database.execScript(`
    DELETE FROM book_categories WHERE category_account_id IN (SELECT id FROM accounts WHERE system_key = '${KEY}');
    DELETE FROM accounts WHERE system_key = '${KEY}';`);
}

describe('Top-ups', () => {
  it('is built in under Miscellaneous for a new workspace, once, and is the one a card top-up names', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    const made = await topUpsIn(database, book.id);
    expect(made.map((row) => [row.name, row.parent])).toEqual([['Top-ups', 'miscellaneous']]);
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });

    // The money-in door finds it rather than making a second.
    const wallet = await createAccount(database, ws, { name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });
    const card = await createCardAccount(database, ws, { name: 'Card', subtype: 'credit_card', currency: 'IDR' });
    await moveMoneyIn(database, ws, { toId: wallet.id, fromId: card.id, amountMinor: 100_000, feeMinor: 0, occurredOn: '2026-10-20', description: 'Top up', feeDescription: 'Top-up fee' });
    expect(await topUpsIn(database, book.id)).toEqual(made);
    expect(await topUpsCategory(database, ws)).toBe(made[0]!.id);
  });

  it('is added once to a workspace from before it was built in, under the id worked out from the book', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);

    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [KEY] });
    const made = await topUpsIn(database, book.id);
    expect(made.map((row) => [row.id, row.name, row.parent])).toEqual([[await defaultCategoryIdOf(book.id, KEY), 'Top-ups', 'miscellaneous']]);

    // The app opens every day: nothing more is made.
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
    expect(await topUpsIn(database, book.id)).toEqual(made);
  });

  it('keeps the Top-ups a card top-up already made on first need, and makes no second', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    // Before the upgrade, a card's top-up of a wallet made Top-ups under Miscellaneous the first time it needed one.
    const wallet = await createAccount(database, ws, { name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });
    const card = await createCardAccount(database, ws, { name: 'Card', subtype: 'credit_card', currency: 'IDR' });
    await moveMoneyIn(database, ws, { toId: wallet.id, fromId: card.id, amountMinor: 100_000, feeMinor: 2_500, occurredOn: '2026-10-20', description: 'Top up', feeDescription: 'Top-up fee' });
    const onDemand = await topUpsIn(database, book.id);
    expect(onDemand).toHaveLength(1);
    expect(onDemand[0]!.id).not.toBe(await defaultCategoryIdOf(book.id, KEY));

    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
    expect(await topUpsIn(database, book.id)).toEqual(onDemand);
  });

  it('takes over a "Top-ups" made by hand under Miscellaneous instead of making a second', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    const miscellaneous = (await categoriesOf(database, book.id)).find((row) => row.key === 'miscellaneous')!;
    await database.execScript(`
      INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, valuation_mode, sort_order, created_at)
        VALUES ('own-top-ups', '${ws.workspaceId}', '${miscellaneous.id}', 'expense', 'category', 'top-ups', 'derived', 9, '2026-09-01T00:00:00Z');
      INSERT INTO book_categories (category_account_id, workspace_id, book_id) VALUES ('own-top-ups', '${ws.workspaceId}', '${book.id}');`);

    const result = await ensureCategoryKeys(database, ws);
    expect(result.created).not.toContain(KEY);
    expect((await topUpsIn(database, book.id)).map((row) => row.id)).toEqual(['own-top-ups']);
    expect(await ensureCategoryKeys(database, ws)).toEqual({ keyed: [], created: [] });
  });

  it('is not added under a Miscellaneous that was put away', async () => {
    const db = await setupDb();
    executor = db.executor;
    const { database, ws } = db;
    const book = await personalBook(database, ws);
    await asBeforeTheUpgrade(database);
    await database.execScript(`UPDATE accounts SET archived_at = ${ARCHIVED} WHERE system_key = 'miscellaneous'`);

    expect((await ensureCategoryKeys(database, ws)).created).toEqual([]);
    expect(await topUpsIn(database, book.id)).toEqual([]);
  });
});
