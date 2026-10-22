import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { categoryIdsByKey, createAccount, createBook, inBook, personalBook, postTransaction, replaceTransaction, settledBeforeAppOf } from '../src/index';
import { setupDb } from './helpers';

const twoBooks = async () => {
  const { database, ws } = await setupDb();
  const personal = (await personalBook(database, ws)).id;
  const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const mine = (await categoryIdsByKey(database, inBook(ws, personal)))['food_beverage.restaurants']!;
  const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['food_beverage.restaurants']!;
  return { database, ws, personal, business, card: card.id, mine, theirs };
};

const dinnerOn = (category: string, card: string, amount = 640_000) => ({
  occurredOn: '2026-09-02',
  description: 'Supplier dinner',
  lines: [
    { accountId: category, amountMinor: amount, currency: 'IDR' },
    { accountId: card, amountMinor: -amount, currency: 'IDR' },
  ],
});

const bookOf = async (database: Awaited<ReturnType<typeof setupDb>>['database'], id: string) =>
  database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${id}`);

describe('moving a saved transaction to another workspace', () => {
  it('moves when the edit says so, with the category copy in the other workspace', async () => {
    const { database, ws, personal, business, card, mine, theirs } = await twoBooks();
    const dinner = await postTransaction(database, inBook(ws, personal), dinnerOn(mine, card));
    const moved = await replaceTransaction(database, inBook(ws, personal), dinner, { ...dinnerOn(theirs, card), moveToBook: true });
    expect(await bookOf(database, moved)).toEqual([[business]]);
    expect(await database.db.values(sql`SELECT status FROM transactions WHERE id = ${dinner}`)).toEqual([['void']]);
  });

  it('still refuses another workspace’s category on an ordinary edit', async () => {
    const { database, ws, personal, card, mine, theirs } = await twoBooks();
    const dinner = await postTransaction(database, inBook(ws, personal), dinnerOn(mine, card));
    await expect(replaceTransaction(database, inBook(ws, personal), dinner, dinnerOn(theirs, card))).rejects.toMatchObject({ code: 'OTHER_BOOK' });
  });
});

describe('already paid off, changed on an edit', () => {
  it('adds the settlement when asked, takes it away when asked, and keeps it when not asked', async () => {
    const { database, ws, personal, card, mine } = await twoBooks();
    const at = inBook(ws, personal);
    const dinner = await postTransaction(database, at, dinnerOn(mine, card));
    expect(await settledBeforeAppOf(database, at, dinner)).toBe(false);

    const paid = await replaceTransaction(database, at, dinner, { ...dinnerOn(mine, card), settledBeforeApp: true });
    expect(await settledBeforeAppOf(database, at, paid)).toBe(true);

    // Not mentioned: it follows the purchase, at the edited figure.
    const larger = await replaceTransaction(database, at, paid, dinnerOn(mine, card, 700_000));
    expect(await settledBeforeAppOf(database, at, larger)).toBe(true);

    const owed = await replaceTransaction(database, at, larger, { ...dinnerOn(mine, card, 700_000), settledBeforeApp: false });
    expect(await settledBeforeAppOf(database, at, owed)).toBe(false);
  });
});
