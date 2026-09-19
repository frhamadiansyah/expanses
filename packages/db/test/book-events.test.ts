import { describe, expect, it } from 'vitest';
import {
  booksInEvent,
  budgetSheetFor,
  categoryIdsByKey,
  categoryTotalsBetween,
  createAccount,
  createBook,
  eventPlanFor,
  inBook,
  linkEventItem,
  listTransactions,
  ownerScope,
  personalBook,
  postTransaction,
  saveEvent,
  saveEventItem,
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
    expect((await eventPlanFor(database, ownerScope(ws), eventId)).spentMinor).toBe(11_840_000);
    expect((await eventPlanFor(database, inBook(ws, business), eventId)).spentMinor).toBe(640_000);
    expect((await eventPlanFor(database, inBook(ws, business), eventId)).lines.map((line) => line.name)).toEqual(['Restaurants']);
  });

  it('reads the plan whole, and one workspace at a time, with the figures adding up in each', async () => {
    const { database, ws, personal, business } = await copy();
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const eventId = await saveEvent(database, ws, { name: 'Singapore holiday', startsOn: '2026-08-13', endsOn: '2026-08-17' });
    const keysOf = (bookId: string) => categoryIdsByKey(database, inBook(ws, bookId));
    const hotels = (await keysOf(personal))['travel.hotels']!;
    const meals = (await keysOf(business))['food_beverage.restaurants']!;

    const mine = await saveEventItem(database, ws, eventId, { name: 'Hotel Jen', quantity: 4, unitPriceMinor: 2_750_000, categoryAccountId: hotels });
    await saveEventItem(database, ws, eventId, { name: 'Client dinner', unitPriceMinor: 1_000_000, categoryAccountId: meals });
    const spend = async (bookId: string, categoryId: string, amountMinor: number) => {
      const id = await postTransaction(database, inBook(ws, bookId), {
        occurredOn: '2026-08-15',
        description: 'x',
        lines: [
          { accountId: categoryId, amountMinor, currency: 'IDR' },
          { accountId: card.id, amountMinor: -amountMinor, currency: 'IDR' },
        ],
      });
      await tagTransaction(database, ws, id, eventId);
      return id;
    };
    // The whole hotel bill is the hotel item, so it answers for all of it: the default share is the estimate.
    await linkEventItem(database, ws, mine, await spend(personal, hotels, 11_200_000), 11_200_000);
    await spend(business, meals, 640_000);

    const whole = await eventPlanFor(database, ownerScope(ws), eventId);
    const theirs = await eventPlanFor(database, inBook(ws, business), eventId);
    const ours = await eventPlanFor(database, inBook(ws, personal), eventId);

    expect(whole).toMatchObject({ plannedMinor: 12_000_000, spentMinor: 11_840_000, toBuyMinor: 1_000_000, differenceMinor: 200_000, notPlannedMinor: 640_000 });
    // One tab: that workspace's items and that workspace's money, and nothing of the other's.
    expect(theirs).toMatchObject({ plannedMinor: 1_000_000, spentMinor: 640_000, toBuyMinor: 1_000_000, notPlannedMinor: 640_000 });
    expect(theirs.lines.map((line) => line.name)).toEqual(['Restaurants']);
    expect(ours).toMatchObject({ plannedMinor: 11_000_000, spentMinor: 11_200_000, toBuyMinor: 0, differenceMinor: 200_000, notPlannedMinor: 0 });

    /*
     * The two identities the screen relies on, checked against figures worked out by hand from the fixture rather
     * than against the subtractions that produced them — an assertion reading `toBuy + boughtEstimate === planned`
     * is true of any arithmetic at all, since toBuy is defined as that difference.
     *
     * Whole:    plan 4 × 2.750.000 + 1.000.000 = 12.000.000; the hotel was bought for 11.200.000, the dinner is not;
     *           so still to buy 1.000.000, bought at its estimate 11.000.000, and 640.000 of restaurant money that
     *           answers no item at all. Spent 11.200.000 + 640.000.
     * Business: only the dinner and only the restaurant money.
     * Personal: only the hotel — bought, nothing left to buy, nothing unplanned.
     */
    const byHand = [
      [whole, { plannedMinor: 12_000_000, toBuyMinor: 1_000_000, boughtEstimateMinor: 11_000_000, boughtActualMinor: 11_200_000, notPlannedMinor: 640_000, spentMinor: 11_840_000 }],
      [theirs, { plannedMinor: 1_000_000, toBuyMinor: 1_000_000, boughtEstimateMinor: 0, boughtActualMinor: 0, notPlannedMinor: 640_000, spentMinor: 640_000 }],
      [ours, { plannedMinor: 11_000_000, toBuyMinor: 0, boughtEstimateMinor: 11_000_000, boughtActualMinor: 11_200_000, notPlannedMinor: 0, spentMinor: 11_200_000 }],
    ] as const;
    for (const [plan, hand] of byHand) {
      expect(plan).toMatchObject(hand);
      expect(hand.toBuyMinor + hand.boughtEstimateMinor).toBe(hand.plannedMinor);
      expect(hand.boughtActualMinor + hand.notPlannedMinor).toBe(hand.spentMinor);
    }
  });

  it('leaves out a workspace that only planned, and one that has nothing to do with it', async () => {
    const { database, ws, personal, business } = await copy();
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const eventId = await saveEvent(database, ws, { name: 'Singapore holiday', startsOn: '2026-08-13', endsOn: '2026-08-17' });
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['food_beverage.restaurants']!;
    await saveEventItem(database, ws, eventId, { name: 'Client dinner', unitPriceMinor: 1_000_000, categoryAccountId: theirs });

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
