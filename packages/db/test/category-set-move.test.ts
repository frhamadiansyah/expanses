import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addSetCategory,
  archiveBook,
  categoryIdsOfBook,
  CategorySetError,
  createAccount,
  createBook,
  createCategorySet,
  eventCategories,
  inBook,
  listCategorySets,
  listSetCategories,
  moveCategorySet,
  personalBook,
  postTransaction,
  saveEvent,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function setup() {
  const db = await setupDb();
  current = db;
  const personal = (await personalBook(db.database, db.ws)).id;
  const family = await createBook(db.database, db.ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR' });
  const setId = await createCategorySet(db.database, db.ws, 'Trip');
  const flights = await addSetCategory(db.database, db.ws, setId, 'Flights');
  const hotels = await addSetCategory(db.database, db.ws, setId, 'Hotels');
  const wallet = await createAccount(db.database, db.ws, { name: 'Cash', kind: 'asset', subtype: 'cash', currency: 'IDR' });
  return { db, personal, family, setId, flights, hotels, wallet: wallet.id };
}

const spend = (category: string, wallet: string, description = 'Flight') => ({
  occurredOn: '2026-09-02',
  description,
  lines: [
    { accountId: category, amountMinor: 500_000, currency: 'IDR' },
    { accountId: wallet, amountMinor: -500_000, currency: 'IDR' },
  ],
});

const filedAt = async (db: TestDb, table: 'book_categories' | 'book_category_sets' | 'book_transactions', key: string, id: string) =>
  db.database.db.values(sql.raw(`SELECT book_id FROM ${table} WHERE ${key} = '${id}'`));

describe('moving a category set to another workspace', () => {
  it('re-files the set and every category, keeping every id', async () => {
    const { db, personal, family, setId, flights, hotels } = await setup();
    const result = await moveCategorySet(db.database, db.ws, { setId, toBookId: family });
    expect(result).toMatchObject({ id: setId, name: 'Trip', moved: 2 });

    expect(await filedAt(db, 'book_category_sets', 'set_id', setId)).toEqual([[family]]);
    expect(await filedAt(db, 'book_categories', 'category_account_id', flights)).toEqual([[family]]);
    expect(await filedAt(db, 'book_categories', 'category_account_id', hotels)).toEqual([[family]]);
    expect((await listSetCategories(db.database, db.ws, setId)).map((r) => r.id).sort()).toEqual([flights, hotels].sort());

    const inFamily = new Set(await categoryIdsOfBook(db.database, family));
    const inPersonal = new Set(await categoryIdsOfBook(db.database, personal));
    for (const id of [flights, hotels]) {
      expect(inFamily.has(id)).toBe(true);
      expect(inPersonal.has(id)).toBe(false);
    }
    expect((await listCategorySets(db.database, { ...db.ws, bookId: family })).map((s) => s.id)).toEqual([setId]);
    expect(await listCategorySets(db.database, { ...db.ws, bookId: personal })).toEqual([]);
  });

  it('keeps an event on the same set, offering its categories only in the new workspace', async () => {
    const { db, personal, family, setId, flights } = await setup();
    const eventId = await saveEvent(db.database, db.ws, { name: 'Bali', startsOn: '2026-11-01', endsOn: '2026-11-05', setId });
    expect(await eventCategories(db.database, inBook(db.ws, personal), eventId)).toContain(flights);
    await moveCategorySet(db.database, db.ws, { setId, toBookId: family });
    const events = await db.database.db.values(sql`SELECT set_id FROM events WHERE id = ${eventId}`);
    expect(events).toEqual([[setId]]);
    expect(await eventCategories(db.database, inBook(db.ws, personal), eventId)).not.toContain(flights);
    expect(await eventCategories(db.database, inBook(db.ws, family), eventId)).toContain(flights);
  });

  it('heals the owner state: transactions already in the destination under categories still filed in the old workspace', async () => {
    const { db, personal, family, setId, flights, hotels, wallet } = await setup();
    const eventId = await saveEvent(db.database, db.ws, { name: 'Bali', startsOn: '2026-11-01', endsOn: '2026-11-05', setId });
    const a = await postTransaction(db.database, inBook(db.ws, personal), spend(flights, wallet));
    const b = await postTransaction(db.database, inBook(db.ws, personal), spend(hotels, wallet, 'Hotel'));
    // What a move of the transactions alone leaves behind: they are in Family, their categories are still Personal's.
    await db.database.db.run(sql`UPDATE book_transactions SET book_id = ${family} WHERE transaction_id IN (${a}, ${b})`);
    const stateBefore = new Set(await categoryIdsOfBook(db.database, family));
    expect(stateBefore.has(flights)).toBe(false);
    expect(await eventCategories(db.database, inBook(db.ws, family), eventId)).toEqual([]);

    await moveCategorySet(db.database, db.ws, { setId, toBookId: family });

    // Every transaction filed in Family now reads categories of Family, with the ids unchanged.
    const stillOther = await db.database.db.values(sql`
      SELECT t.id FROM transactions t JOIN entries e ON e.transaction_id = t.id
      JOIN book_transactions bt ON bt.transaction_id = t.id
      JOIN book_categories bc ON bc.category_account_id = e.account_id
      WHERE bc.book_id <> bt.book_id`);
    expect(stillOther).toEqual([]);
    const inFamily = new Set(await categoryIdsOfBook(db.database, family));
    expect(inFamily.has(flights) && inFamily.has(hotels)).toBe(true);
    // The picker offers them in Family and the event's Add spending does too.
    expect((await eventCategories(db.database, inBook(db.ws, family), eventId)).sort()).toEqual([flights, hotels].sort());
    // And a new purchase under them posts in Family.
    const c = await postTransaction(db.database, inBook(db.ws, family), spend(flights, wallet, 'Taxi'));
    expect(await filedAt(db, 'book_transactions', 'transaction_id', c)).toEqual([[family]]);
  });

  it('refuses while a transaction in the old workspace still uses the set, moving nothing; voided ones do not count', async () => {
    const { db, personal, family, setId, flights, wallet } = await setup();
    const tx = await postTransaction(db.database, inBook(db.ws, personal), spend(flights, wallet));
    await expect(moveCategorySet(db.database, db.ws, { setId, toBookId: family })).rejects.toMatchObject({ code: 'HAS_TRANSACTIONS' });
    expect(await filedAt(db, 'book_categories', 'category_account_id', flights)).toEqual([[personal]]);
    expect(await filedAt(db, 'book_category_sets', 'set_id', setId)).toEqual([[personal]]);

    await db.database.db.run(sql`UPDATE transactions SET status = 'void' WHERE id = ${tx}`);
    await moveCategorySet(db.database, db.ws, { setId, toBookId: family });
    expect(await filedAt(db, 'book_categories', 'category_account_id', flights)).toEqual([[family]]);
  });

  it('refuses the same workspace, an archived one, a missing one and a missing set', async () => {
    const { db, personal, family, setId } = await setup();
    await expect(moveCategorySet(db.database, db.ws, { setId, toBookId: personal })).rejects.toMatchObject({ code: 'SAME_BOOK' });
    await expect(moveCategorySet(db.database, db.ws, { setId, toBookId: 'nowhere' })).rejects.toBeInstanceOf(CategorySetError);
    await expect(moveCategorySet(db.database, db.ws, { setId: 'nope', toBookId: family })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await archiveBook(db.database, db.ws, family);
    await expect(moveCategorySet(db.database, db.ws, { setId, toBookId: family })).rejects.toMatchObject({ code: 'NO_DESTINATION' });
    expect(await filedAt(db, 'book_category_sets', 'set_id', setId)).toEqual([[personal]]);
  });

  it('is atomic: a failure part-way leaves the set and its categories where they were', async () => {
    const { db, personal, family, setId, flights, hotels } = await setup();
    await db.database.execScript(
      `CREATE TRIGGER stop_set_move BEFORE UPDATE ON book_category_sets BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
    );
    await expect(moveCategorySet(db.database, db.ws, { setId, toBookId: family })).rejects.toThrow();
    expect(await filedAt(db, 'book_categories', 'category_account_id', flights)).toEqual([[personal]]);
    expect(await filedAt(db, 'book_categories', 'category_account_id', hotels)).toEqual([[personal]]);
    expect(await filedAt(db, 'book_category_sets', 'set_id', setId)).toEqual([[personal]]);
  });
});
