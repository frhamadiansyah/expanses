import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { budgetSheetFor, categoryTotalsBetween, createAccount, deleteEvent, eventPlanFor, finishEvent, firstTransactionDate, linkEventItem, listEvents, listTransactions, postTransaction, replaceTransaction, saveBudget, saveEvent, saveEventItem, suggestForEvent, tagTransaction, voidTransaction } from '../src/index';
import { setupDb } from './helpers';

const MONTH = '2026-09';
const WINDOW = { startsOn: `${MONTH}-18`, endsOn: `${MONTH}-28` };

async function household() {
  const { database, ws } = await setupDb();
  const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const gifts = await createAccount(database, ws, { name: 'Gift giving', kind: 'expense', subtype: 'category', currency: null });
  const food = await createAccount(database, ws, { name: 'Food', kind: 'expense', subtype: 'category', currency: null });
  return { database, ws, bca, gifts, food };
}

type Household = Awaited<ReturnType<typeof household>>;

const spend = ({ database, ws, bca }: Household, categoryId: string, occurredOn: string, amountMinor: number, description = 'Spending') =>
  postTransaction(database, ws, {
    occurredOn,
    description,
    lines: [
      { accountId: categoryId, amountMinor, currency: 'IDR' },
      { accountId: bca.id, amountMinor: -amountMinor, currency: 'IDR' },
    ],
  });

const lebaran = (context: Household) => saveEvent(context.database, context.ws, { name: 'Lebaran', ...WINDOW });

describe('finishing an event', () => {
  it('calls it done and puts it back, keeping it in the list either way', async () => {
    const context = await household();
    const id = await lebaran(context);

    await finishEvent(context.database, context.ws, id, true);
    const finished = (await listEvents(context.database, context.ws)).find((event) => event.id === id)!;
    expect(finished.finishedAt).toEqual(expect.any(String));

    await finishEvent(context.database, context.ws, id, false);
    expect((await listEvents(context.database, context.ws)).find((event) => event.id === id)!.finishedAt).toBeNull();
  });
});

describe('saveEvent', () => {
  it('stores an occasion and its window', async () => {
    const context = await household();
    await lebaran(context);

    expect(await listEvents(context.database, context.ws)).toEqual([
      { id: expect.any(String), name: 'Lebaran', startsOn: WINDOW.startsOn, endsOn: WINDOW.endsOn, goalId: null, setId: null, finishedAt: null },
    ]);
    // A plan is a list of things to buy, and its total is those items' sum. `events.planned_minor` stays in the
    // table for the databases that already carry a figure in it; no writer here puts one there, and no row carries
    // it forward. Read raw, because the row shape deliberately no longer has anywhere to show it.
    expect(await context.database.db.values<[number | null]>(sql`SELECT planned_minor FROM events`)).toEqual([[null]]);
  });

  it('refuses an occasion that ends before it starts', async () => {
    const context = await household();

    await expect(
      saveEvent(context.database, context.ws, { name: 'Backwards', startsOn: `${MONTH}-28`, endsOn: `${MONTH}-18` }),
    ).rejects.toThrow(/cannot end before/);
  });

  it('drops one you no longer want', async () => {
    const context = await household();
    await deleteEvent(context.database, context.ws, await lebaran(context));

    expect(await listEvents(context.database, context.ws)).toEqual([]);
  });
});

describe('the plan', () => {
  it('adds the items up, and a category is only what its items come to', async () => {
    const context = await household();
    const id = await lebaran(context);
    await saveEventItem(context.database, context.ws, id, { name: 'Hampers', quantity: 6, unitPriceMinor: 500_000, categoryAccountId: context.gifts.id });
    await saveEventItem(context.database, context.ws, id, { name: 'Angpau', unitPriceMinor: 4_000_000, categoryAccountId: context.gifts.id });
    await saveEventItem(context.database, context.ws, id, { name: 'Ketupat', unitPriceMinor: 500_000, categoryAccountId: context.food.id });

    const plan = await eventPlanFor(context.database, context.ws, id);
    expect(plan).toMatchObject({ hasPlan: true, plannedMinor: 7_500_000, toBuyMinor: 7_500_000, spentMinor: 0, notPlannedMinor: 0 });
    expect(plan.lines.map((line) => [line.name, line.plannedMinor])).toEqual([
      ['Gift giving', 7_000_000],
      ['Food', 500_000],
    ]);
  });

  it('counts what was bought against its estimate, and what nobody planned beside it', async () => {
    const context = await household();
    const id = await lebaran(context);
    const item = await saveEventItem(context.database, context.ws, id, { name: 'Hampers', unitPriceMinor: 3_000_000, categoryAccountId: context.gifts.id });
    const bought = await spend(context, context.gifts.id, `${MONTH}-20`, 3_450_000, 'Toko Hampers');
    await tagTransaction(context.database, context.ws, bought, id);
    // No share typed: the whole receipt is this one item, and that is what ticking it off claims. The 450.000 it
    // went over by is therefore an item bought over, not money nobody planned.
    await linkEventItem(context.database, context.ws, item, bought);
    const extra = await spend(context, context.food.id, `${MONTH}-21`, 200_000, 'Ketupat');
    await tagTransaction(context.database, context.ws, extra, id);

    const plan = await eventPlanFor(context.database, context.ws, id);
    expect(plan).toMatchObject({
      plannedMinor: 3_000_000,
      spentMinor: 3_650_000,
      toBuyMinor: 0,
      boughtEstimateMinor: 3_000_000,
      boughtActualMinor: 3_450_000,
      differenceMinor: 450_000,
      notPlannedMinor: 200_000,
      overCount: 1,
      // Food has money and no items, so the plan does not pretend to cover it.
      plannedSpentMinor: 3_450_000,
      unplannedCategoryCount: 1,
    });
    expect(plan.lines.find((line) => line.categoryId === context.food.id)).toMatchObject({ planned: false, plannedMinor: 0, unplannedMinor: 200_000 });
  });

  /*
   * A refund, a discount or a price correction booked back to a spending category is a negative expense line. What
   * the event spent is the lines added up, never each line's size added up: the second would have the event and the
   * category report disagreeing about the very same receipts, with the event the one inventing rupiah.
   */
  it('nets a refund line off what it spent, agreeing with the category report to the rupiah', async () => {
    const context = await household();
    const id = await lebaran(context);
    const receipt = await postTransaction(context.database, context.ws, {
      occurredOn: `${MONTH}-20`,
      description: 'Toko Hampers',
      lines: [
        { accountId: context.gifts.id, amountMinor: 3_000_000, currency: 'IDR' },
        { accountId: context.gifts.id, amountMinor: -1_000_000, currency: 'IDR' },
        { accountId: context.bca.id, amountMinor: -2_000_000, currency: 'IDR' },
      ],
    });
    await tagTransaction(context.database, context.ws, receipt, id);

    // Rp30.000 of hampers with Rp10.000 handed back: Rp20.000 left the bank, worked out by hand from the lines.
    const plan = await eventPlanFor(context.database, context.ws, id);
    expect(plan.spentMinor).toBe(2_000_000);
    expect(plan.lines.find((line) => line.categoryId === context.gifts.id)!.actualMinor).toBe(2_000_000);
    // And Cashflow, asked for the same window, reaches the same figure by its own path.
    const report = await categoryTotalsBetween(context.database, context.ws, 'expense', `${MONTH}-01`, `${MONTH}-30`);
    expect(report.reduce((total, row) => total + row.amountBaseMinor, 0)).toBe(2_000_000);
  });

  it('puts an item back on the list when its purchase is voided', async () => {
    const context = await household();
    const id = await lebaran(context);
    const item = await saveEventItem(context.database, context.ws, id, { name: 'Hampers', unitPriceMinor: 3_000_000, categoryAccountId: context.gifts.id });
    const bought = await spend(context, context.gifts.id, `${MONTH}-20`, 3_450_000, 'Toko Hampers');
    await tagTransaction(context.database, context.ws, bought, id);
    await linkEventItem(context.database, context.ws, item, bought);
    await voidTransaction(context.database, context.ws, bought);

    expect(await eventPlanFor(context.database, context.ws, id)).toMatchObject({
      boughtCount: 0,
      toBuyMinor: 3_000_000,
      spentMinor: 0,
      notPlannedMinor: 0,
      differenceMinor: 0,
    });
  });

  /*
   * Untagging or re-tagging a receipt leaves the item's link where it is — the link is a reading of a purchase, and
   * nothing in the tag rewrites it — so the reading is where a purchase that has gone to another occasion has to
   * stop answering for this one, exactly as a voided one does. Both come out of the same filter: the plan counts a
   * purchase only while it is posted AND still tagged here.
   */
  it('puts an item back on the list when its purchase is tagged to another event', async () => {
    const context = await household();
    const id = await lebaran(context);
    const other = await saveEvent(context.database, context.ws, { name: 'Idul Adha', ...WINDOW });
    const item = await saveEventItem(context.database, context.ws, id, { name: 'Hampers', unitPriceMinor: 3_000_000, categoryAccountId: context.gifts.id });
    const bought = await spend(context, context.gifts.id, `${MONTH}-20`, 3_450_000, 'Toko Hampers');
    await tagTransaction(context.database, context.ws, bought, id);
    await linkEventItem(context.database, context.ws, item, bought);
    await tagTransaction(context.database, context.ws, bought, other);

    expect(await eventPlanFor(context.database, context.ws, id)).toMatchObject({
      boughtCount: 0,
      toBuyMinor: 3_000_000,
      spentMinor: 0,
      notPlannedMinor: 0,
      differenceMinor: 0,
    });
    // And the occasion it was moved to counts the money, against no item of its own.
    expect(await eventPlanFor(context.database, context.ws, other)).toMatchObject({ hasPlan: false, spentMinor: 3_450_000, notPlannedMinor: 3_450_000 });
  });

  it('an event with no items reads as it always did: what was tagged, by category', async () => {
    const context = await household();
    const id = await lebaran(context);
    const bought = await spend(context, context.gifts.id, `${MONTH}-20`, 1_800_000, 'Toko Hampers');
    await tagTransaction(context.database, context.ws, bought, id);

    expect(await eventPlanFor(context.database, context.ws, id)).toMatchObject({
      hasPlan: false,
      plannedMinor: 0,
      plannedSpentMinor: 0,
      spentMinor: 1_800_000,
      notPlannedMinor: 1_800_000,
      purchaseCount: 1,
    });
  });

  it('suggests what to tag from the categories its items name', async () => {
    const context = await household();
    const id = await lebaran(context);
    await spend(context, context.gifts.id, `${MONTH}-20`, 4_200_000, 'Hampers');

    expect(await suggestForEvent(context.database, context.ws, id)).toEqual([]);
    await saveEventItem(context.database, context.ws, id, { name: 'Hampers', unitPriceMinor: 3_000_000, categoryAccountId: context.gifts.id });
    expect((await suggestForEvent(context.database, context.ws, id)).map((row) => row.description)).toEqual(['Hampers']);
  });
});

describe('suggestForEvent', () => {
  it('offers payments inside the window in a category the occasion draws on', async () => {
    const context = await household();
    const id = await lebaran(context);
    await saveEventItem(context.database, context.ws, id, { name: 'Gift giving', unitPriceMinor: 3_000_000, categoryAccountId: context.gifts.id });
    await spend(context, context.gifts.id, `${MONTH}-20`, 1_500_000, 'Hampers');

    const candidates = await suggestForEvent(context.database, context.ws, id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ description: 'Hampers', amountBaseMinor: 1_500_000 });
  });

  it('leaves out what falls outside the window', async () => {
    const context = await household();
    const id = await lebaran(context);
    await saveEventItem(context.database, context.ws, id, { name: 'Gift giving', unitPriceMinor: 3_000_000, categoryAccountId: context.gifts.id });
    await spend(context, context.gifts.id, `${MONTH}-02`, 1_500_000);

    expect(await suggestForEvent(context.database, context.ws, id)).toEqual([]);
  });

  it('leaves out a category the occasion does not draw on', async () => {
    const context = await household();
    const id = await lebaran(context);
    await saveEventItem(context.database, context.ws, id, { name: 'Gift giving', unitPriceMinor: 3_000_000, categoryAccountId: context.gifts.id });
    await spend(context, context.food.id, `${MONTH}-20`, 900_000);

    expect(await suggestForEvent(context.database, context.ws, id)).toEqual([]);
  });

  it('stops offering a payment once it is tagged', async () => {
    const context = await household();
    const id = await lebaran(context);
    await saveEventItem(context.database, context.ws, id, { name: 'Gift giving', unitPriceMinor: 3_000_000, categoryAccountId: context.gifts.id });
    const transactionId = await spend(context, context.gifts.id, `${MONTH}-20`, 1_500_000);
    await tagTransaction(context.database, context.ws, transactionId, id);

    expect(await suggestForEvent(context.database, context.ws, id)).toEqual([]);
  });

  /*
   * A receipt carrying a refund, a discount or a price correction booked back to the same category is one payment
   * with two expense lines, one of them negative. What is offered is what actually left the account.
   */
  it('offers a receipt with a refund line at its net, once, and never at the sizes added up', async () => {
    const context = await household();
    const id = await lebaran(context);
    await saveEventItem(context.database, context.ws, id, { name: 'Gift giving', unitPriceMinor: 3_000_000, categoryAccountId: context.gifts.id });
    await postTransaction(context.database, context.ws, {
      occurredOn: `${MONTH}-20`,
      description: 'Hampers',
      lines: [
        { accountId: context.gifts.id, amountMinor: 5_000_000, currency: 'IDR' },
        { accountId: context.gifts.id, amountMinor: -1_000_000, currency: 'IDR' },
        { accountId: context.bca.id, amountMinor: -4_000_000, currency: 'IDR' },
      ],
    });

    const candidates = await suggestForEvent(context.database, context.ws, id);
    // One row for one payment: Rp40.000 left the bank, not Rp50.000, and certainly not Rp60.000 over two rows.
    expect(candidates.map((row) => [row.description, row.amountBaseMinor])).toEqual([['Hampers', 4_000_000]]);
  });

  it('offers a refund of its own at nought rather than as money that left the account', async () => {
    const context = await household();
    const id = await lebaran(context);
    await saveEventItem(context.database, context.ws, id, { name: 'Gift giving', unitPriceMinor: 3_000_000, categoryAccountId: context.gifts.id });
    await postTransaction(context.database, context.ws, {
      occurredOn: `${MONTH}-21`,
      description: 'Hampers returned',
      lines: [
        { accountId: context.gifts.id, amountMinor: -1_200_000, currency: 'IDR' },
        { accountId: context.bca.id, amountMinor: 1_200_000, currency: 'IDR' },
      ],
    });

    // Still offered — money that came back inside the window belongs to the occasion — but never as spending.
    expect((await suggestForEvent(context.database, context.ws, id)).map((row) => [row.description, row.amountBaseMinor])).toEqual([
      ['Hampers returned', 0],
    ]);
  });

  it('offers a receipt split across two of the occasion categories once, at the two lines together', async () => {
    const context = await household();
    const id = await lebaran(context);
    await saveEventItem(context.database, context.ws, id, { name: 'Gift giving', unitPriceMinor: 3_000_000, categoryAccountId: context.gifts.id });
    await saveEventItem(context.database, context.ws, id, { name: 'Open house', unitPriceMinor: 1_000_000, categoryAccountId: context.food.id });
    await postTransaction(context.database, context.ws, {
      occurredOn: `${MONTH}-22`,
      description: 'Ranch Market',
      lines: [
        { accountId: context.gifts.id, amountMinor: 2_000_000, currency: 'IDR' },
        { accountId: context.food.id, amountMinor: 700_000, currency: 'IDR' },
        { accountId: context.bca.id, amountMinor: -2_700_000, currency: 'IDR' },
      ],
    });

    const candidates = await suggestForEvent(context.database, context.ws, id);
    // One payment is one question, and tagging answers all of it: two rows would ask it twice and, tagged, tag both.
    expect(candidates.map((row) => [row.description, row.amountBaseMinor, row.categoryAccountId])).toEqual([['Ranch Market', 2_700_000, context.gifts.id]]);
  });

  it('offers nothing while the occasion draws on no category, rather than the whole month', async () => {
    const context = await household();
    const id = await lebaran(context);
    await spend(context, context.gifts.id, `${MONTH}-20`, 1_500_000);

    expect(await suggestForEvent(context.database, context.ws, id)).toEqual([]);
  });
});

describe('the monthly budget', () => {
  it('leaves an occasion out of the caps but still takes it off what is left', async () => {
    const context = await household();
    await saveBudget(context.database, context.ws, { categoryAccountId: context.gifts.id, amountMinor: 1_000_000 });
    const id = await lebaran(context);
    const transactionId = await spend(context, context.gifts.id, `${MONTH}-20`, 5_000_000, 'Hampers');

    const before = await budgetSheetFor(context.database, context.ws, MONTH);
    expect(before.spendingActualMinor).toBe(5_000_000);
    expect(before.overCount).toBe(1);

    await tagTransaction(context.database, context.ws, transactionId, id);

    // The cap is no longer blown by money that was always meant to go, but the money is still gone.
    const after = await budgetSheetFor(context.database, context.ws, MONTH);
    expect(after.spendingActualMinor).toBe(0);
    expect(after.overCount).toBe(0);
    expect(after.eventSpendingMinor).toBe(5_000_000);
    expect(after.leftOverActualMinor).toBe(before.leftOverActualMinor);
  });
});

describe('editing tagged spending', () => {
  it('keeps the event tag when a purchase is corrected', async () => {
    const context = await household();
    const id = await lebaran(context);
    await saveEventItem(context.database, context.ws, id, { name: 'Gift giving', unitPriceMinor: 3_000_000, categoryAccountId: context.gifts.id });
    const transactionId = await spend(context, context.gifts.id, `${MONTH}-20`, 1_500_000);
    await tagTransaction(context.database, context.ws, transactionId, id);

    await replaceTransaction(context.database, context.ws, transactionId, {
      occurredOn: `${MONTH}-21`,
      description: 'Hampers, corrected',
      lines: [
        { accountId: context.gifts.id, amountMinor: 1_800_000, currency: 'IDR' },
        { accountId: context.bca.id, amountMinor: -1_800_000, currency: 'IDR' },
      ],
    });

    expect((await eventPlanFor(context.database, context.ws, id)).spentMinor).toBe(1_800_000);
  });
});

describe('an event\'s history', () => {
  it('lists what was tagged to the event, and nothing else from the same days', async () => {
    const context = await household();
    const id = await lebaran(context);
    const hampers = await spend(context, context.gifts.id, `${MONTH}-20`, 4_200_000, 'Hampers');
    await spend(context, context.food.id, `${MONTH}-20`, 85_000, 'Warung');
    await tagTransaction(context.database, context.ws, hampers, id);

    const history = await listTransactions(context.database, context.ws, { eventId: id });
    expect(history.map((row) => row.description)).toEqual(['Hampers']);
  });
});

describe('firstTransactionDate', () => {
  it('is the oldest recorded day, and nothing before anything is recorded', async () => {
    const context = await household();
    expect(await firstTransactionDate(context.database, context.ws)).toBeNull();
    await spend(context, context.food.id, `${MONTH}-20`, 85_000);
    await spend(context, context.food.id, '2025-03-02', 40_000);
    expect(await firstTransactionDate(context.database, context.ws)).toBe('2025-03-02');
  });
});
