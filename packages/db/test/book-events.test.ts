import { describe, expect, it } from 'vitest';
import {
  booksInEvent,
  budgetSheetFor,
  categoryIdsByKey,
  categoryTotalsBetween,
  createAccount,
  createBook,
  eventSheetFor,
  inBook,
  listEventBudgets,
  listTransactions,
  ownerScope,
  personalBook,
  postTransaction,
  saveEvent,
  setEventBudget,
  tagTransaction,
} from '../src/index';
import { setupDb } from './helpers';

const copy = async () => {
  const { database, ws } = await setupDb();
  const personal = await personalBook(database, ws);
  const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
  return { database, ws, personal: personal.id, business };
};

describe('an event across workspaces', () => {
  it('names the workspaces that spent in it, and narrows the ring to one at a time', async () => {
    const { database, ws, personal, business } = await copy();
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const eventId = await saveEvent(database, ws, { name: 'Singapore holiday', startsOn: '2026-08-13', endsOn: '2026-08-17', plannedMinor: 15_000_000 });
    const spend = async (bookId: string, key: string, amountMinor: number) => {
      const keys = await categoryIdsByKey(database, inBook(ws, bookId));
      const id = await postTransaction(database, inBook(ws, bookId), {
        occurredOn: '2026-08-15',
        description: 'x',
        lines: [
          { accountId: keys[key]!, amountMinor, currency: 'IDR' },
          { accountId: card.id, amountMinor: -amountMinor, currency: 'IDR' },
        ],
      });
      await tagTransaction(database, ws, id, eventId);
      return keys[key]!;
    };
    await spend(personal, 'travel.hotels', 11_200_000);
    await spend(business, 'food_beverage.restaurants', 640_000);

    expect((await booksInEvent(database, ws, eventId)).map((book) => book.name)).toEqual(['Personal', 'Business']);
    // All: the whole trip. One tab: that workspace's share, and only its categories.
    expect((await eventSheetFor(database, ownerScope(ws), eventId)).actualMinor).toBe(11_840_000);
    expect((await eventSheetFor(database, inBook(ws, business), eventId)).actualMinor).toBe(640_000);
    expect((await eventSheetFor(database, inBook(ws, business), eventId)).lines.map((line) => line.name)).toEqual(['Restaurants']);
    // Rp 15.000.000 was set for the trip, not for Business's part of it, so its tab is not measured against it.
    expect((await eventSheetFor(database, ownerScope(ws), eventId)).plannedMinor).toBe(15_000_000);
    expect((await eventSheetFor(database, inBook(ws, business), eventId)).plannedMinor).toBeNull();
  });

  it('shows each workspace only the part of the plan it can spend against', async () => {
    const { database, ws, personal, business } = await copy();
    const eventId = await saveEvent(database, ws, { name: 'Singapore holiday', startsOn: '2026-08-13', endsOn: '2026-08-17' });
    const mine = (await categoryIdsByKey(database, inBook(ws, personal)))['travel.hotels']!;
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['food_beverage.restaurants']!;
    await setEventBudget(database, ws, eventId, { categoryAccountId: mine, plannedMinor: 11_000_000 });
    await setEventBudget(database, ws, eventId, { categoryAccountId: theirs, plannedMinor: 1_000_000 });

    // All is the whole plan; a tab is the part of it filed in that workspace.
    expect((await listEventBudgets(database, ownerScope(ws), eventId)).map((row) => row.categoryAccountId).sort()).toEqual([mine, theirs].sort());
    expect(await listEventBudgets(database, inBook(ws, business), eventId)).toEqual([{ categoryAccountId: theirs, plannedMinor: 1_000_000 }]);
    // So Business's ring is measured against its own share of the plan, not the whole trip's.
    expect((await eventSheetFor(database, inBook(ws, business), eventId)).plannedMinor).toBe(1_000_000);
    expect((await eventSheetFor(database, ownerScope(ws), eventId)).plannedMinor).toBe(12_000_000);
  });

  it('leaves out a workspace that only planned, and one that has nothing to do with it', async () => {
    const { database, ws, personal, business } = await copy();
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const eventId = await saveEvent(database, ws, { name: 'Singapore holiday', startsOn: '2026-08-13', endsOn: '2026-08-17' });
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['food_beverage.restaurants']!;
    await setEventBudget(database, ws, eventId, { categoryAccountId: theirs, plannedMinor: 1_000_000 });

    // A plan is not spending: no tab appears until money is actually tagged to the event from that workspace.
    expect(await booksInEvent(database, ws, eventId)).toEqual([]);

    const mine = (await categoryIdsByKey(database, inBook(ws, personal)))['travel.hotels']!;
    const id = await postTransaction(database, inBook(ws, personal), {
      occurredOn: '2026-08-15',
      description: 'Hotel',
      lines: [
        { accountId: mine, amountMinor: 11_200_000, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -11_200_000, currency: 'IDR' },
      ],
    });
    await tagTransaction(database, ws, id, eventId);
    expect((await booksInEvent(database, ws, eventId)).map((book) => book.name)).toEqual(['Personal']);
  });
});

/**
 * Moving your own money is not spending, so it belongs to no workspace at all. It has to stay visible from every
 * one of them — a workspace that hid it would leave the account unexplainable from inside — while counting in
 * none of their figures. Nothing here is new behaviour: this is the rule that is easiest to break later.
 */
describe('a transfer between your own accounts', () => {
  it('shows a transfer in every workspace and counts it in none', async () => {
    const { database, ws, personal, business } = await copy();
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const pot = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR' });
    await postTransaction(database, ws, {
      occurredOn: '2026-09-11',
      description: 'Top up',
      lines: [
        { accountId: pot.id, amountMinor: 500_000, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -500_000, currency: 'IDR' },
      ],
    });
    for (const bookId of [personal, business]) {
      expect((await listTransactions(database, inBook(ws, bookId))).map((t) => t.description)).toContain('Top up');
      expect(await categoryTotalsBetween(database, inBook(ws, bookId), 'expense', '2026-09-01', '2026-09-30')).toEqual([]);
    }
  });
});

describe('whether a workspace’s caps see an event', () => {
  it('keeps a holiday out of Personal’s caps and inside Business’s', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;
    // Business counts its events: a client trip is what that workspace is for, so its caps are meant to feel it.
    const business = await createBook(database, ws, {
      name: 'Business',
      kind: 'business',
      baseCurrency: 'IDR',
      countEventsInBudget: true,
      copyCategoriesFrom: personal,
    });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const eventId = await saveEvent(database, ws, { name: 'Singapore holiday', startsOn: '2026-08-13', endsOn: '2026-08-17' });
    const spend = async (bookId: string, key: string, amountMinor: number) => {
      const keys = await categoryIdsByKey(database, inBook(ws, bookId));
      const id = await postTransaction(database, inBook(ws, bookId), {
        occurredOn: '2026-08-15',
        description: 'x',
        lines: [
          { accountId: keys[key]!, amountMinor, currency: 'IDR' },
          { accountId: card.id, amountMinor: -amountMinor, currency: 'IDR' },
        ],
      });
      await tagTransaction(database, ws, id, eventId);
    };
    await spend(personal, 'travel.hotels', 11_200_000);
    await spend(business, 'food_beverage.restaurants', 640_000);

    const personalSheet = await budgetSheetFor(database, inBook(ws, personal), '2026-08');
    const businessSheet = await budgetSheetFor(database, inBook(ws, business), '2026-08');

    // Personal holds the trip apart: nothing against its caps, the whole of its own share on the event line.
    expect(personalSheet.spendingActualMinor).toBe(0);
    expect(personalSheet.eventSpendingMinor).toBe(11_200_000);
    // Business's share is inside its caps — and taken off what is left exactly once, not twice.
    expect(businessSheet.spendingActualMinor).toBe(640_000);
    expect(businessSheet.eventSpendingMinor).toBe(640_000);
    expect(businessSheet.leftOverActualMinor).toBe(businessSheet.incomeActualMinor - 640_000);
  });
});
