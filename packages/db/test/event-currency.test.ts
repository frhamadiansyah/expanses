import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccount,
  createDatabase,
  createWorkspace,
  eventPlanFor,
  linkEventItem,
  listEventItems,
  listEvents,
  migrate,
  MIGRATIONS,
  postTransaction,
  removeEventItem,
  saveEvent,
  saveEventItem,
  setEventCurrency,
  tagTransaction,
  upsertRate,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

const WINDOW = { startsOn: '2026-03-03', endsOn: '2026-03-12' };

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function rate(database: Awaited<ReturnType<typeof setupDb>>['database'], from: string, value: number, onDate = '2020-01-01') {
  await upsertRate(database, { fromCurrency: from, toCurrency: 'IDR', onDate, rate: value, source: 'manual', sourceDate: onDate });
}

describe('migration 0104', () => {
  it('is version 104 and named event_currency', () => {
    expect(MIGRATIONS.find((m) => m.version === 104)).toMatchObject({ name: 'event_currency' });
  });

  it('leaves an item written before it reading as the base currency, even in an event that now plans in lira', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(
      older,
      MIGRATIONS.filter((m) => m.version <= 103),
    );
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const trip = await saveEvent(older, ws, { name: 'Turkey trip', ...WINDOW });
    const flight = await saveEventItem(older, ws, trip, { name: 'Flight', unitPriceMinor: 9_800_000 });
    // A build before 0104 reads an event without a currency and an item without one.
    expect(await listEventItems(older, ws, trip)).toMatchObject([{ id: flight, unitPriceMinor: 9_800_000, currency: null }]);

    expect(await migrate(older)).toEqual([104, 105, 106, 107, 108, 109, 110, 111]);
    await rate(older, 'TRY', 400);
    await setEventCurrency(older, ws, trip, 'TRY');

    expect((await listEvents(older, ws))[0]!.currency).toBe('TRY');
    const [view] = (await eventPlanFor(older, ws, trip)).lines[0]!.items;
    // Still rupiah: the event's lira did not reach into a price that was typed before items had a currency.
    expect(view).toMatchObject({ currency: 'IDR', estimateOwnMinor: 9_800_000, estimateMinor: 9_800_000, estimateEventMinor: 2_450_000 });
  });

  it('reads as the base currency on a database that never had the tables, and refuses nothing', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(
      older,
      MIGRATIONS.filter((m) => m.version <= 103),
    );
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const trip = await saveEvent(older, ws, { name: 'Trip', ...WINDOW, currency: 'TRY' });
    await saveEventItem(older, ws, trip, { name: 'Flight', unitPriceMinor: 1_000, currency: 'EUR' });
    expect((await listEvents(older, ws))[0]!.currency).toBeNull();
    expect(await listEventItems(older, ws, trip)).toMatchObject([{ currency: null }]);
  });
});

describe('an event with a currency', () => {
  async function trip() {
    const { database, ws } = await setupDb();
    await rate(database, 'EUR', 18_000);
    await rate(database, 'TRY', 400);
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const sights = await createAccount(database, ws, { name: 'Sightseeing', kind: 'expense', subtype: 'category', currency: null });
    const eventId = await saveEvent(database, ws, { name: 'Turkey trip', ...WINDOW, currency: 'TRY' });
    return { database, ws, bank, sights, eventId };
  }

  it('keeps each item in its own currency and totals them in the event currency', async () => {
    const { database, ws, eventId, sights } = await trip();
    await saveEventItem(database, ws, eventId, { name: 'Flight', unitPriceMinor: 9_800_000, currency: 'IDR', categoryAccountId: sights.id });
    await saveEventItem(database, ws, eventId, { name: 'Museum pass', unitPriceMinor: 9_500, currency: 'EUR', categoryAccountId: sights.id });
    await saveEventItem(database, ws, eventId, { name: 'Dinner', quantity: 6, unitPriceMinor: 180_000, currency: 'TRY', categoryAccountId: sights.id });

    const plan = await eventPlanFor(database, ws, eventId);
    expect(plan.plannedEventMinor).toBe(2_450_000 + 427_500 + 1_080_000);
    expect(plan.plannedMinor).toBe(9_800_000 + 1_710_000 + 4_320_000);
    expect(plan.missingRates).toEqual([]);
    expect((await listEvents(database, ws))[0]!.currency).toBe('TRY');
  });

  it('leaves an item whose currency has no rate out of the totals', async () => {
    const { database, ws, eventId } = await trip();
    await saveEventItem(database, ws, eventId, { name: 'Dinner', unitPriceMinor: 180_000, currency: 'TRY' });
    await saveEventItem(database, ws, eventId, { name: 'Ferry', unitPriceMinor: 5_000, currency: 'USD' });
    const plan = await eventPlanFor(database, ws, eventId);
    expect(plan.plannedEventMinor).toBe(180_000);
    expect(plan.missingRates).toEqual(['USD']);
  });

  it('holds a bought item at what was paid, whatever the rate does afterwards', async () => {
    const { database, ws, eventId, sights, bank } = await trip();
    const museum = await saveEventItem(database, ws, eventId, { name: 'Museum pass', unitPriceMinor: 9_500, currency: 'EUR', categoryAccountId: sights.id });
    const paid = await postTransaction(database, ws, {
      occurredOn: '2026-03-04',
      description: 'Museum',
      lines: [
        { accountId: sights.id, amountMinor: 1_656_000, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -1_656_000, currency: 'IDR' },
      ],
    });
    await tagTransaction(database, ws, paid, eventId);
    await linkEventItem(database, ws, museum, paid);
    await rate(database, 'EUR', 20_000, '2026-03-10');

    const [view] = (await eventPlanFor(database, ws, eventId)).lines[0]!.items;
    // Paid Rp 1.656.000 on the 4th, when a euro was Rp 18.000: EUR 92. The 10th's rate does not touch it.
    expect(view).toMatchObject({ paidOwnMinor: 9_200, paidEventMinor: 414_000, estimateMinor: 1_710_000 });
  });

  it('changes freely before anything is bought, and is refused after', async () => {
    const { database, ws, eventId, sights, bank } = await trip();
    const item = await saveEventItem(database, ws, eventId, { name: 'Museum pass', unitPriceMinor: 9_500, currency: 'EUR', categoryAccountId: sights.id });
    await setEventCurrency(database, ws, eventId, 'EUR');
    expect((await listEvents(database, ws))[0]!.currency).toBe('EUR');
    // Nothing was rewritten: the item still has its own currency and price.
    expect(await listEventItems(database, ws, eventId)).toMatchObject([{ currency: 'EUR', unitPriceMinor: 9_500 }]);

    const paid = await postTransaction(database, ws, {
      occurredOn: '2026-03-04',
      description: 'Museum',
      lines: [
        { accountId: sights.id, amountMinor: 1_656_000, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -1_656_000, currency: 'IDR' },
      ],
    });
    await tagTransaction(database, ws, paid, eventId);
    await linkEventItem(database, ws, item, paid);

    await expect(setEventCurrency(database, ws, eventId, 'TRY')).rejects.toMatchObject({ code: 'CURRENCY_FIXED' });
    // Asking for what it already is is not a change.
    await setEventCurrency(database, ws, eventId, 'EUR');
    expect((await listEvents(database, ws))[0]!.currency).toBe('EUR');
  });

  it('refuses a currency the app does not know, and the base currency clears the row', async () => {
    const { database, ws, eventId } = await trip();
    await expect(setEventCurrency(database, ws, eventId, 'XXQ')).rejects.toMatchObject({ code: 'BAD_CURRENCY' });
    await setEventCurrency(database, ws, eventId, 'IDR');
    expect((await listEvents(database, ws))[0]!.currency).toBeNull();
  });

  it('drops an item’s currency with the item', async () => {
    const { database, ws, eventId } = await trip();
    const id = await saveEventItem(database, ws, eventId, { name: 'Dinner', unitPriceMinor: 180_000, currency: 'TRY' });
    await removeEventItem(database, ws, id);
    expect(await database.db.values(sql`SELECT count(*) FROM event_item_currency WHERE item_id = ${id}`)).toEqual([[0]]);
  });
});
