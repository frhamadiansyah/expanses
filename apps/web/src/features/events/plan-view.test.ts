import { eventPlan, type EventPlanInput } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  afterSaving,
  coverTotals,
  differenceWords,
  eventListLine,
  gaugeFor,
  itemSubline,
  moneyBackRows,
  planCardRows,
  plannedLabel,
  planTotals,
  quantityWords,
  whereItWentRows,
} from './plan-view';

/** Intl puts a no-break space after "Rp"; the figures below are written with the ordinary one. */
const plain = (text: string) => text.replace(/ /g, ' ');

const input: EventPlanInput = {
  categoryNames: { gear: 'Baby gear', clothes: 'Clothes' },
  items: [
    { id: 'i1', name: 'Stroller', quantity: 1, unitPriceMinor: 12_000_000, categoryId: 'gear', link: null, note: null, purchase: null },
    { id: 'i2', name: 'Crib', quantity: 1, unitPriceMinor: 7_500_000, categoryId: 'gear', link: null, note: null, purchase: { transactionId: 't1', shareMinor: 7_800_000 } },
    { id: 'i3', name: 'Muslin wraps', quantity: 4, unitPriceMinor: 175_000, categoryId: 'clothes', link: null, note: null, purchase: null },
  ],
  actuals: [{ transactionId: 't1', occurredOn: '2026-09-12', description: 'Toko Bayi', categoryId: 'gear', amountBaseMinor: 7_800_000 }],
};
const plan = eventPlan(input);

/** The same event with a category that has money and no items, which is what makes the plan partial. */
const withFood = () =>
  eventPlan({
    ...input,
    actuals: [...input.actuals, { transactionId: 't2', occurredOn: '2026-09-13', description: 'Warung', categoryId: 'food', amountBaseMinor: 5_000_000 }],
    categoryNames: { ...input.categoryNames, food: 'Restaurants' },
  });

describe('the gauge', () => {
  it('measures the categories that have items, and counts the items that went over', () => {
    expect(gaugeFor(plan)).toEqual({ capsMinor: 20_200_000, spentMinor: 7_800_000, overCount: 1, any: true });
  });

  it('measures only the planned part when a category has money and no items', () => {
    const partly = withFood();
    // 12.8m spent against a 20.2m plan would read as under; 7.8m of 20.2m is the truth about the plan.
    expect(gaugeFor(partly)).toMatchObject({ capsMinor: 20_200_000, spentMinor: 7_800_000 });
    expect(plannedLabel(partly)).toBe('Planned so far');
    expect(plannedLabel(plan)).toBe('Planned');
  });
});

describe('words', () => {
  it('says over, under, or exactly', () => {
    expect(plain(differenceWords(450_000).text)).toBe('+Rp 450.000');
    expect(differenceWords(450_000).tone).toBe('over');
    expect(plain(differenceWords(-220_000).text)).toBe('−Rp 220.000');
    expect(differenceWords(-220_000).tone).toBe('under');
    expect(differenceWords(0)).toMatchObject({ text: 'exactly', tone: 'exact' });
  });

  it('shows the arithmetic only when there is more than one of the thing', () => {
    expect(plain(quantityWords(plan.lines[1]!.items[0]!)!)).toBe('4 × Rp 175.000');
    expect(quantityWords(plan.lines[0]!.items[0]!)).toBeNull();
  });

  it('says estimate until it is bought, and then where and when', () => {
    expect(itemSubline(plan.lines[0]!.items[0]!)).toBe('estimate');
    expect(itemSubline(plan.lines[0]!.items[1]!)).toBe('Toko Bayi · 12 Sep');
    expect(plain(itemSubline(plan.lines[1]!.items[0]!))).toBe('4 × Rp 175.000 · estimate');
  });
});

describe('the cards', () => {
  it('is one Plan row per planned category, with how many items and how many are bought', () => {
    expect(planCardRows(plan)).toEqual([
      { categoryId: 'gear', name: 'Baby gear', plannedMinor: 19_500_000, subline: '2 items · 1 bought' },
      { categoryId: 'clothes', name: 'Clothes', plannedMinor: 700_000, subline: '1 item · none bought' },
    ]);
  });

  it('shows every category under "Where it went", saying which ones have no items', () => {
    expect(whereItWentRows(withFood())).toEqual([
      { categoryId: 'gear', name: 'Baby gear', actualMinor: 7_800_000, plannedMinor: 19_500_000, planned: true, subline: '1 purchase' },
      { categoryId: 'clothes', name: 'Clothes', actualMinor: 0, plannedMinor: 700_000, planned: true, subline: 'nothing spent yet' },
      { categoryId: 'food', name: 'Restaurants', actualMinor: 5_000_000, plannedMinor: 0, planned: false, subline: '1 purchase' },
    ]);
  });

  it('says on the events list what is still to buy, or how many purchases there were', () => {
    const line = eventListLine(plan);
    expect(plain(line.subline)).toBe('Planned · Rp 12.700.000 still to buy');
    expect(line).toMatchObject({ amountMinor: 7_800_000, ofMinor: 20_200_000 });
    expect(eventListLine(eventPlan({ ...input, items: [] }))).toEqual({ subline: 'No plan · 1 purchase', amountMinor: 7_800_000, ofMinor: null });
  });
});

describe('what a new item does', () => {
  it('shows the event, what is left to buy, and what is still unclaimed', () => {
    expect(afterSaving(plan, { estimateMinor: 6_500_000 })).toEqual({ plannedMinor: 26_700_000, toBuyMinor: 19_200_000, notPlannedMinor: 0 });
  });

  it('takes the old estimate out first when an item is being edited', () => {
    expect(afterSaving(plan, { estimateMinor: 14_000_000, replacing: 'i1' })).toMatchObject({ plannedMinor: 22_200_000, toBuyMinor: 14_700_000 });
  });

  it('does not put a bought item back on the list when its price each is edited', () => {
    expect(afterSaving(plan, { estimateMinor: 8_000_000, replacing: 'i2' })).toMatchObject({ plannedMinor: 20_700_000, toBuyMinor: 12_700_000 });
  });

  it('is the plan as it stands while nothing has been typed', () => {
    expect(afterSaving(plan, { estimateMinor: 0 })).toEqual({ plannedMinor: 20_200_000, toBuyMinor: 12_700_000, notPlannedMinor: 0 });
  });
});

describe('what a receipt covers', () => {
  it('adds up what has been given out and what is left', () => {
    expect(coverTotals(4_150_000, [1_280_000, 700_000, 900_000])).toEqual({ totalMinor: 4_150_000, givenMinor: 2_880_000, leftMinor: 1_270_000, over: false });
    expect(coverTotals(1_500_000, [1_280_000, 700_000])).toMatchObject({ leftMinor: -480_000, over: true });
  });
});

/*
 * What ticking an item off claims, read back through the words the screen shows.
 *
 * A receipt that answers exactly one item claims the whole receipt, not the item's estimate. The estimate is what
 * was planned and the receipt is what was spent, and the gap between them is the only thing "Difference so far"
 * exists to say: claiming the estimate would report every purchase as exactly on plan while quietly filing the
 * overspend under money nobody planned.
 */
describe('a receipt that is the item', () => {
  it('shows the overspend on the item itself, with nothing pushed into what nobody planned', () => {
    const crib = plan.lines[0]!.items[1]!;
    // By hand from the fixture: 1 × 7.500.000 planned, a 7.800.000 receipt, so 300.000 over.
    expect(crib.estimateMinor).toBe(7_500_000);
    expect(crib.actualMinor).toBe(7_800_000);
    expect(crib.differenceMinor).toBe(300_000);
    expect(plain(differenceWords(crib.differenceMinor!).text)).toBe('+Rp 300.000');
    expect(differenceWords(crib.differenceMinor!).tone).toBe('over');
    // Had the tick claimed 7.500.000 the difference would read "exactly" and 300.000 would sit here instead.
    expect(plan.notPlannedMinor).toBe(0);
    expect(gaugeFor(plan).overCount).toBe(1);
  });
});

/*
 * The two identities every screen below stands on, checked against figures worked out by hand from this fixture.
 *
 * An assertion reading `spent − shares === notPlanned` is true of any arithmetic at all, since `notPlanned` is
 * defined as that subtraction; so each figure here is pinned to its own literal first, and where the plan reaches a
 * figure by subtracting, the same figure is reached again by adding up rows the subtraction never touched.
 *
 * The fixture: a 4.150.000 Mothercare receipt answering two items (1.280.000 of clothes and 700.000 of wraps), a
 * stroller still to buy, and 620.000 at a warung in a category with no items at all.
 */
const shared: EventPlanInput = {
  categoryNames: { clothes: 'Clothes', gear: 'Baby gear', food: 'Restaurants' },
  items: [
    { id: 's1', name: 'Newborn clothes', quantity: 10, unitPriceMinor: 150_000, categoryId: 'clothes', link: null, note: null, purchase: { transactionId: 'm1', shareMinor: 1_280_000 } },
    { id: 's2', name: 'Muslin wraps', quantity: 4, unitPriceMinor: 175_000, categoryId: 'clothes', link: null, note: null, purchase: { transactionId: 'm1', shareMinor: 700_000 } },
    { id: 's3', name: 'Stroller', quantity: 1, unitPriceMinor: 12_000_000, categoryId: 'gear', link: null, note: null, purchase: null },
  ],
  actuals: [
    { transactionId: 'm1', occurredOn: '2026-09-14', description: 'Mothercare', categoryId: 'clothes', amountBaseMinor: 4_150_000 },
    { transactionId: 'm2', occurredOn: '2026-09-15', description: 'Warung', categoryId: 'food', amountBaseMinor: 620_000 },
  ],
};
const sharedPlan = eventPlan(shared);
const items = sharedPlan.lines.flatMap((line) => line.items);
const bought = items.filter((item) => item.bought);

describe('the figures add up', () => {
  it('spends exactly the items’ shares plus the money no item claims', () => {
    // By hand: 4.150.000 at Mothercare and 620.000 at the warung.
    expect(whereItWentRows(sharedPlan).reduce((total, row) => total + row.actualMinor, 0)).toBe(4_770_000);
    // By hand: 1.280.000 + 700.000 of that receipt answers items.
    expect(bought.reduce((total, item) => total + item.actualMinor!, 0)).toBe(1_980_000);
    /*
     * By hand: 4.150.000 − 1.980.000 = 2.170.000 still on the receipt, plus the whole 620.000 warung. The plan
     * reaches it by subtracting shares from spending; the rows below reach it by adding up the leftovers the
     * subtraction never sees, and the two must be the same figure.
     */
    expect(sharedPlan.notPlannedMinor).toBe(2_790_000);
    expect(sharedPlan.lines.flatMap((line) => line.unplanned).reduce((total, row) => total + row.amountBaseMinor, 0)).toBe(2_790_000);
    expect(4_770_000).toBe(1_980_000 + 2_790_000);
  });

  it('plans exactly what is still to buy plus what the bought items were estimated at', () => {
    // By hand: 10 × 150.000 + 4 × 175.000 + 12.000.000.
    expect(planCardRows(sharedPlan).reduce((total, row) => total + row.plannedMinor, 0)).toBe(14_200_000);
    expect(gaugeFor(sharedPlan).capsMinor).toBe(14_200_000);
    // By hand: the stroller alone is unbought, at 12.000.000; the two that are bought were estimated at 2.200.000.
    expect(afterSaving(sharedPlan, { estimateMinor: 0 }).toBuyMinor).toBe(12_000_000);
    expect(items.filter((item) => !item.bought).reduce((total, item) => total + item.estimateMinor, 0)).toBe(12_000_000);
    expect(bought.reduce((total, item) => total + item.estimateMinor, 0)).toBe(2_200_000);
    expect(14_200_000).toBe(12_000_000 + 2_200_000);
  });

  it('never measures the plan against money the plan never meant to cover', () => {
    // By hand: 4.770.000 was spent, but only the 4.150.000 in Clothes falls in a category that has items.
    expect(gaugeFor(sharedPlan)).toEqual({ capsMinor: 14_200_000, spentMinor: 4_150_000, overCount: 0, any: true });
    expect(plannedLabel(sharedPlan)).toBe('Planned so far');
    expect(whereItWentRows(sharedPlan).find((row) => row.categoryId === 'food')).toMatchObject({ planned: false, actualMinor: 620_000 });
  });

  it('says of each bought item what it cost against what it was planned at', () => {
    // By hand: clothes estimated at 1.500.000 and answered with 1.280.000, the wraps at 700.000 and answered exactly.
    expect(bought.map((item) => [item.name, item.estimateMinor, item.actualMinor, item.differenceMinor])).toEqual([
      ['Newborn clothes', 1_500_000, 1_280_000, -220_000],
      ['Muslin wraps', 700_000, 700_000, 0],
    ]);
    expect(plain(differenceWords(-220_000).text)).toBe('−Rp 220.000');
    expect(differenceWords(0).text).toBe('exactly');
  });
});

/**
 * A refund posted as its own transaction and tagged to the event: 3.000.000 of gear fully claimed by the crib, and
 * 1.000.000 handed back a day later on a receipt of its own. Spending is the net 2.000.000, the share is still
 * 3.000.000, and the subtraction that makes "Not planned for" therefore lands at −1.000.000.
 */
const refunded = eventPlan({
  categoryNames: { gear: 'Baby gear' },
  items: [{ id: 'r1', name: 'Crib', quantity: 1, unitPriceMinor: 3_000_000, categoryId: 'gear', link: null, note: null, purchase: { transactionId: 'p1', shareMinor: 3_000_000 } }],
  actuals: [
    { transactionId: 'p1', occurredOn: '2026-09-12', description: 'Toko Bayi', categoryId: 'gear', amountBaseMinor: 3_000_000 },
    { transactionId: 'p2', occurredOn: '2026-09-13', description: 'Toko Bayi refund', categoryId: 'gear', amountBaseMinor: -1_000_000 },
  ],
});

describe('nothing on screen reads below nought', () => {
  it('clamps what a standalone refund drove negative, and hands back what the clamp swallowed', () => {
    // The raw figure, so the clamp has something real to bite on.
    expect(refunded.notPlannedMinor).toBe(-1_000_000);
    expect(planTotals(refunded)).toEqual({
      plannedMinor: 3_000_000,
      boughtActualMinor: 3_000_000,
      toBuyMinor: 0,
      notPlannedMinor: 0,
      moneyBackMinor: 1_000_000,
    });
  });

  it('leaves an ordinary plan’s figures exactly as they are', () => {
    expect(planTotals(sharedPlan)).toEqual({
      plannedMinor: 14_200_000,
      boughtActualMinor: 1_980_000,
      toBuyMinor: 12_000_000,
      notPlannedMinor: 2_790_000,
      moneyBackMinor: 0,
    });
  });

  it('closes the account: spent = the items’ shares + not planned − money back', () => {
    const totals = planTotals(refunded);
    // Every figure derived by hand from the fixture: 3.000.000 out, 1.000.000 back, the crib claiming the whole 3m.
    expect(refunded.spentMinor).toBe(2_000_000);
    expect(refunded.boughtActualMinor).toBe(3_000_000);
    expect(2_000_000).toBe(3_000_000 + totals.notPlannedMinor - totals.moneyBackMinor);
    // And the plan stops calling itself a complete account of the money while a rupiah sits outside it.
    expect(plannedLabel(refunded)).toBe('Planned so far');
  });

  it('clamps the figures the form shows after saving, in the view model rather than in each screen', () => {
    // Editing the crib down to 1.000.000 leaves nothing still to buy and nothing unplanned to show.
    expect(afterSaving(refunded, { estimateMinor: 1_000_000, replacing: 'r1' })).toEqual({
      plannedMinor: 1_000_000,
      toBuyMinor: 0,
      notPlannedMinor: 0,
    });
    // Mid-keystroke the estimate is nought, and a plan of nothing is still not a plan of less than nothing.
    expect(afterSaving(refunded, { estimateMinor: 0, replacing: 'r1' })).toMatchObject({ plannedMinor: 0, toBuyMinor: 0 });
  });

  it('names the refund the plan’s own leftover rows cannot carry', () => {
    // The plan files leftovers under a category only while something is left; a refund has less than nothing left.
    expect(refunded.lines.flatMap((line) => line.unplanned)).toEqual([]);
    expect(
      moneyBackRows([
        { id: 'p1', occurredOn: '2026-09-12', description: 'Toko Bayi', entries: [{ accountKind: 'expense', amountBaseMinor: 3_000_000 }, { accountKind: 'asset', amountBaseMinor: -3_000_000 }] },
        { id: 'p2', occurredOn: '2026-09-13', description: 'Toko Bayi refund', entries: [{ accountKind: 'expense', amountBaseMinor: -1_000_000 }, { accountKind: 'asset', amountBaseMinor: 1_000_000 }] },
      ]),
    ).toEqual([{ transactionId: 'p2', occurredOn: '2026-09-13', description: 'Toko Bayi refund', amountMinor: 1_000_000 }]);
  });
});
