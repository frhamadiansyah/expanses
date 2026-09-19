import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccount,
  createDatabase,
  createWorkspace,
  listEventItems,
  migrate,
  MIGRATIONS,
  removeEventItem,
  saveEvent,
  saveEventItem,
  unlinkEventItem,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

const WINDOW = { startsOn: '2026-09-18', endsOn: '2026-09-28' };

async function newborn() {
  const { database, ws } = await setupDb();
  const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const gear = await createAccount(database, ws, { name: 'Baby gear', kind: 'expense', subtype: 'category', currency: null });
  const clothes = await createAccount(database, ws, { name: 'Clothes', kind: 'expense', subtype: 'category', currency: null });
  const eventId = await saveEvent(database, ws, { name: 'Newborn', ...WINDOW });
  return { database, ws, bca, gear, clothes, eventId };
}

describe('saving an item', () => {
  it('keeps how many, a price each, a category, a link and a note, and appends in order', async () => {
    const { database, ws, eventId, gear } = await newborn();
    await saveEventItem(database, ws, eventId, {
      name: 'Check-ups',
      quantity: 6,
      unitPriceMinor: 500_000,
      categoryAccountId: gear.id,
      link: 'tokopedia.com/bugaboo-fox-5',
      note: 'Second-hand is fine',
    });
    await saveEventItem(database, ws, eventId, { name: 'Cash for the midwife', unitPriceMinor: 2_000_000 });

    expect(await listEventItems(database, ws, eventId)).toEqual([
      {
        id: expect.any(String),
        eventId,
        name: 'Check-ups',
        quantity: 6,
        unitPriceMinor: 500_000,
        categoryAccountId: gear.id,
        // A link with no scheme is given one; nothing is ever fetched.
        link: 'https://tokopedia.com/bugaboo-fox-5',
        note: 'Second-hand is fine',
        transactionId: null,
        shareMinor: null,
        sortOrder: 0,
      },
      {
        id: expect.any(String),
        eventId,
        name: 'Cash for the midwife',
        // One of something is the ordinary case, so the quantity need not be given.
        quantity: 1,
        unitPriceMinor: 2_000_000,
        categoryAccountId: null,
        link: null,
        note: null,
        transactionId: null,
        shareMinor: null,
        sortOrder: 1,
      },
    ]);
  });

  it('edits in place without moving it', async () => {
    const { database, ws, eventId, gear, clothes } = await newborn();
    const id = await saveEventItem(database, ws, eventId, { name: 'Crib', unitPriceMinor: 7_500_000, categoryAccountId: gear.id });
    await saveEventItem(database, ws, eventId, { name: 'Muslin wraps', quantity: 4, unitPriceMinor: 175_000, categoryAccountId: gear.id });

    await saveEventItem(database, ws, eventId, { id, name: 'Crib (used)', quantity: 1, unitPriceMinor: 6_900_000, categoryAccountId: clothes.id, note: '  ' });
    expect((await listEventItems(database, ws, eventId))[0]).toMatchObject({
      name: 'Crib (used)',
      unitPriceMinor: 6_900_000,
      categoryAccountId: clothes.id,
      note: null,
      sortOrder: 0,
    });
  });

  it('refuses a nameless item, a nought quantity or price, a category that is not one, and a link that is not one', async () => {
    const { database, ws, eventId, bca } = await newborn();
    const crib = { name: 'Crib', unitPriceMinor: 7_500_000 };
    await expect(saveEventItem(database, ws, eventId, { ...crib, name: '  ' })).rejects.toMatchObject({ code: 'NAME_REQUIRED' });
    await expect(saveEventItem(database, ws, eventId, { ...crib, quantity: 0 })).rejects.toMatchObject({ code: 'QUANTITY_RANGE' });
    await expect(saveEventItem(database, ws, eventId, { ...crib, quantity: 1.5 })).rejects.toMatchObject({ code: 'QUANTITY_RANGE' });
    await expect(saveEventItem(database, ws, eventId, { ...crib, unitPriceMinor: 0 })).rejects.toMatchObject({ code: 'PRICE_RANGE' });
    await expect(saveEventItem(database, ws, eventId, { ...crib, categoryAccountId: bca.id })).rejects.toMatchObject({ code: 'NOT_A_CATEGORY' });
    await expect(saveEventItem(database, ws, eventId, { ...crib, link: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'BAD_LINK' });
    await expect(saveEventItem(database, ws, eventId, { ...crib, link: 'two words' })).rejects.toMatchObject({ code: 'BAD_LINK' });
  });

  it('keeps a link that already has a scheme, and drops an empty one', async () => {
    const { database, ws, eventId } = await newborn();
    const id = await saveEventItem(database, ws, eventId, { name: 'Crib', unitPriceMinor: 7_500_000, link: 'http://toko.example/crib' });
    expect((await listEventItems(database, ws, eventId))[0]!.link).toBe('http://toko.example/crib');
    await saveEventItem(database, ws, eventId, { id, name: 'Crib', unitPriceMinor: 7_500_000, link: '   ' });
    expect((await listEventItems(database, ws, eventId))[0]!.link).toBeNull();
  });

  it('drops one you no longer mean to buy', async () => {
    const { database, ws, eventId } = await newborn();
    const id = await saveEventItem(database, ws, eventId, { name: 'Crib', unitPriceMinor: 7_500_000 });
    await removeEventItem(database, ws, id);
    expect(await listEventItems(database, ws, eventId)).toEqual([]);
  });
});

describe('unlinking a purchase', () => {
  it('takes the tick off and leaves everything else as it was', async () => {
    const { database, ws, eventId, gear } = await newborn();
    const id = await saveEventItem(database, ws, eventId, { name: 'Crib', unitPriceMinor: 7_500_000, categoryAccountId: gear.id });
    // Task 3 is what writes these; written straight in here so the undo can be proved on its own.
    await database.db.values(sql`UPDATE event_items SET transaction_id = 't1', share_minor = 6900000 WHERE id = ${id}`);

    await unlinkEventItem(database, ws, id);
    expect((await listEventItems(database, ws, eventId))[0]).toMatchObject({
      name: 'Crib',
      unitPriceMinor: 7_500_000,
      categoryAccountId: gear.id,
      transactionId: null,
      shareMinor: null,
    });
  });
});

/**
 * A build that has run migration 0049 can be opened against a database that has not. Every read and write asks the
 * table is there first, so such a database reads as an event with no plan rather than throwing — the same shape
 * `hasBooks` gives the book-scoped reads.
 */
describe('a database stopped before 0049', () => {
  let executor: NodeExecutor | undefined;
  afterEach(() => {
    executor?.close();
    executor = undefined;
  });

  it('reads no items and quietly accepts the writes it cannot keep', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(
      older,
      MIGRATIONS.filter((m) => m.version <= 47),
    );
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const eventId = await saveEvent(older, ws, { name: 'Newborn', ...WINDOW });

    const id = await saveEventItem(older, ws, eventId, { name: 'Crib', unitPriceMinor: 7_500_000 });
    expect(id).toEqual(expect.any(String));
    expect(await listEventItems(older, ws, eventId)).toEqual([]);
    await expect(removeEventItem(older, ws, id)).resolves.toBeUndefined();
    await expect(unlinkEventItem(older, ws, id)).resolves.toBeUndefined();

    // Refusals still bite, because they are checked before the table is asked about.
    await expect(saveEventItem(older, ws, eventId, { name: 'Crib', unitPriceMinor: 7_500_000, quantity: 1.5 })).rejects.toMatchObject({
      code: 'QUANTITY_RANGE',
    });
  });
});
