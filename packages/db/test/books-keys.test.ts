import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { categoryIdsByKey, categoryIdsByKeyAll, createAccount, createBook, inBook, personalBook } from '../src/index';
import { setupDb } from './helpers';

const copy = async () => {
  const { database, ws } = await setupDb();
  const personal = await personalBook(database, ws);
  const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
  return { database, ws, personal: personal.id, business };
};

describe('a system key once every workspace has a copy of it', () => {
  it('answers with the open workspace’s copy, and with every copy when asked for all', async () => {
    const { database, ws, personal, business } = await copy();
    const key = 'food_beverage.restaurants';
    const mine = (await categoryIdsByKey(database, inBook(ws, personal)))[key]!;
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))[key]!;
    expect(mine).not.toBe(theirs);
    // No book named: Personal, as every default has always been.
    expect((await categoryIdsByKey(database, ws))[key]).toBe(mine);
    expect([...(await categoryIdsByKeyAll(database, ws))[key]!].sort()).toEqual([mine, theirs].sort());

    // Each id really is filed in the book that claimed it.
    expect(await database.db.values(sql`SELECT book_id FROM book_categories WHERE category_account_id = ${theirs}`)).toEqual([[business]]);
  });

  it('keeps a new category out of it until it is given a key', async () => {
    const { database, ws, business } = await copy();
    const fresh = await createAccount(database, inBook(ws, business), { name: 'Client gifts', kind: 'expense', subtype: 'category', currency: null });
    const all = await categoryIdsByKeyAll(database, ws);
    expect(Object.values(all).flat()).not.toContain(fresh.id);
  });
});
