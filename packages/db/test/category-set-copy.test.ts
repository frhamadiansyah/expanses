import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addSetCategory,
  archiveAccount,
  archiveBook,
  categoryIdsOfBook,
  CategorySetError,
  copyCategorySet,
  createBook,
  createCategorySet,
  listCategorySets,
  listSetCategories,
  personalBook,
  saveCategoryMcc,
  setCategoryIcon,
} from '../src/index';
import { accounts } from '../src/schema';
import { categoryMccs } from '../src/schema-points';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function twoBooks() {
  const db = await setupDb();
  const personal = await personalBook(db.database, db.ws);
  const business = await createBook(db.database, db.ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
  return { db, personal: personal.id, business };
}

describe('copying a category set into another workspace', () => {
  it('copies names, parents, kind, icon and code, and files them in the destination only', async () => {
    const { db, personal, business } = await twoBooks();
    current = db;
    const setId = await createCategorySet(db.database, db.ws, 'Trip');
    const a = await addSetCategory(db.database, db.ws, setId, 'Flights');
    const b = await addSetCategory(db.database, db.ws, setId, 'Seat upgrades');
    await db.database.db.update(accounts).set({ parentId: a }).where(eq(accounts.id, b));
    await setCategoryIcon(db.database, db.ws, a, 'plane');
    await saveCategoryMcc(db.database, db.ws, a, '4511');

    const copy = await copyCategorySet(db.database, db.ws, { setId, toBookId: business });
    expect(copy.name).toBe('Trip');
    expect(copy.id).not.toBe(setId);

    const copied = await listSetCategories(db.database, db.ws, copy.id);
    expect(copied.map((row) => row.name).sort()).toEqual(['Flights', 'Seat upgrades']);
    expect(copied.map((row) => row.id)).not.toContain(a);
    const rows = await db.database.db.select().from(accounts);
    const flights = rows.find((r) => r.id === copied.find((c) => c.name === 'Flights')!.id)!;
    const seats = rows.find((r) => r.id === copied.find((c) => c.name === 'Seat upgrades')!.id)!;
    expect(seats.parentId).toBe(flights.id);
    expect(flights.kind).toBe('expense');
    expect(flights.icon).toBe('plane');
    const mccs = await db.database.db.select().from(categoryMccs);
    expect(mccs.find((m) => m.categoryId === flights.id)?.mcc).toBe('4511');

    // The picker's inOpenBook: the destination offers the copies, the source does not.
    const inBusiness = new Set(await categoryIdsOfBook(db.database, business));
    const inPersonal = new Set(await categoryIdsOfBook(db.database, personal));
    for (const c of copied) {
      expect(inBusiness.has(c.id)).toBe(true);
      expect(inPersonal.has(c.id)).toBe(false);
    }
    expect(inBusiness.has(a)).toBe(false);
    expect((await listCategorySets(db.database, { ...db.ws, bookId: business })).map((s) => s.name)).toEqual(['Trip']);
    // The original is untouched.
    expect((await listSetCategories(db.database, db.ws, setId)).map((r) => r.name).sort()).toEqual(['Flights', 'Seat upgrades']);
  });

  it('skips archived categories', async () => {
    const { db, business } = await twoBooks();
    current = db;
    const setId = await createCategorySet(db.database, db.ws, 'Trip');
    await addSetCategory(db.database, db.ws, setId, 'Flights');
    const gone = await addSetCategory(db.database, db.ws, setId, 'Visa');
    await archiveAccount(db.database, db.ws, gone);
    const copy = await copyCategorySet(db.database, db.ws, { setId, toBookId: business });
    expect((await listSetCategories(db.database, db.ws, copy.id)).map((r) => r.name)).toEqual(['Flights']);
  });

  it('numbers the name when the destination already has one', async () => {
    const { db, business } = await twoBooks();
    current = db;
    const setId = await createCategorySet(db.database, db.ws, 'Trip');
    expect((await copyCategorySet(db.database, db.ws, { setId, toBookId: business })).name).toBe('Trip');
    expect((await copyCategorySet(db.database, db.ws, { setId, toBookId: business })).name).toBe('Trip 2');
    expect((await copyCategorySet(db.database, db.ws, { setId, toBookId: business })).name).toBe('Trip 3');
  });

  it('refuses the same book, an archived book and a book that is not here, copying nothing', async () => {
    const { db, personal, business } = await twoBooks();
    current = db;
    const setId = await createCategorySet(db.database, db.ws, 'Trip');
    await addSetCategory(db.database, db.ws, setId, 'Flights');
    const before = (await db.database.db.select().from(accounts)).length;
    await expect(copyCategorySet(db.database, db.ws, { setId, toBookId: personal })).rejects.toMatchObject({ code: 'SAME_BOOK' });
    await expect(copyCategorySet(db.database, db.ws, { setId, toBookId: 'nowhere' })).rejects.toBeInstanceOf(CategorySetError);
    await archiveBook(db.database, db.ws, business);
    await expect(copyCategorySet(db.database, db.ws, { setId, toBookId: business })).rejects.toMatchObject({ code: 'NO_DESTINATION' });
    expect((await db.database.db.select().from(accounts)).length).toBe(before);
    expect(await listCategorySets(db.database, { ...db.ws, bookId: business })).toEqual([]);
  });

  it('is atomic: a failure part-way copies nothing', async () => {
    const { db, business } = await twoBooks();
    current = db;
    const setId = await createCategorySet(db.database, db.ws, 'Trip');
    await addSetCategory(db.database, db.ws, setId, 'Flights');
    await addSetCategory(db.database, db.ws, setId, 'Hotels');
    const before = (await db.database.db.select().from(accounts)).length;
    await db.database.execScript(`CREATE TRIGGER stop_second BEFORE INSERT ON accounts WHEN NEW.name = 'Hotels' AND NEW.created_at > '2000' AND (SELECT COUNT(*) FROM accounts WHERE name = 'Hotels') >= 1 BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
    await expect(copyCategorySet(db.database, db.ws, { setId, toBookId: business })).rejects.toThrow();
    expect((await db.database.db.select().from(accounts)).length).toBe(before);
    expect(await listCategorySets(db.database, { ...db.ws, bookId: business })).toEqual([]);
  });
});
