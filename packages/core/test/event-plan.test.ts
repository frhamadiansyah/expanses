import { describe, expect, it } from 'vitest';
import { eventPlan, type EventPlanInput, type EventPlanItemInput } from '../src/index';

const NAMES = { gear: 'Baby gear', hospital: 'Hospital', clothes: 'Clothes' };

const item = (
  id: string,
  name: string,
  quantity: number,
  unitPriceMinor: number,
  categoryId: string | null,
  purchase: { transactionId: string; shareMinor: number } | null = null,
): EventPlanItemInput => ({ id, name, quantity, unitPriceMinor, categoryId, link: null, note: null, purchase });

const actual = (transactionId: string, categoryId: string, amountBaseMinor: number, occurredOn: string, description: string) => ({
  transactionId,
  occurredOn,
  description,
  categoryId,
  amountBaseMinor,
});

/** The mockup's own fixture: three categories, seven items, three bought, one purchase nobody planned. */
const newborn = (over: Partial<EventPlanInput> = {}): EventPlanInput => ({
  categoryNames: NAMES,
  items: [
    item('i1', 'Stroller Bugaboo', 1, 12_000_000, 'gear'),
    item('i2', 'Car seat', 1, 6_500_000, 'gear'),
    item('i3', 'Crib', 1, 7_500_000, 'gear', { transactionId: 't1', shareMinor: 7_200_000 }),
    item('i4', 'Delivery package', 1, 18_000_000, 'hospital'),
    item('i5', 'Check-ups', 6, 500_000, 'hospital', { transactionId: 't2', shareMinor: 3_450_000 }),
    item('i6', 'Newborn clothes', 10, 150_000, 'clothes', { transactionId: 't3', shareMinor: 1_280_000 }),
    item('i7', 'Muslin wraps', 4, 175_000, 'clothes'),
  ],
  actuals: [
    actual('t1', 'gear', 7_200_000, '2026-09-12', 'Toko Bayi'),
    actual('t2', 'hospital', 3_450_000, '2026-09-02', 'RS Bunda'),
    actual('t3', 'clothes', 1_280_000, '2026-09-08', 'Mothercare'),
    actual('t4', 'gear', 900_000, '2026-09-14', 'Bottle steriliser'),
  ],
  ...over,
});

describe('the figures', () => {
  const plan = eventPlan(newborn());

  it('plans how many × price each, and spends everything tagged', () => {
    // Six check-ups at Rp500.000 is Rp3.000.000, and ten sets of clothes at Rp150.000 is Rp1.500.000.
    expect(plan.plannedMinor).toBe(49_200_000);
    expect(plan.spentMinor).toBe(12_830_000);
    expect(plan).toMatchObject({ hasPlan: true, itemCount: 7, boughtCount: 3, purchaseCount: 4, unplannedCategoryCount: 0 });
  });

  it('measures the plan against the categories that have items, which here is all of them', () => {
    expect(plan.plannedSpentMinor).toBe(12_830_000);
  });

  it('still to buy is the estimates of what has not been bought', () => {
    expect(plan.toBuyMinor).toBe(12_000_000 + 6_500_000 + 18_000_000 + 700_000);
  });

  it('the difference so far weighs only what was actually bought', () => {
    expect(plan.boughtEstimateMinor).toBe(12_000_000);
    expect(plan.boughtActualMinor).toBe(11_930_000);
    expect(plan.differenceMinor).toBe(-70_000);
    expect(plan.overCount).toBe(1);
  });

  it('not planned is what was tagged with no item claiming it', () => {
    expect(plan.notPlannedMinor).toBe(900_000);
  });

  it('keeps both invariants', () => {
    expect(plan.toBuyMinor + plan.boughtEstimateMinor).toBe(plan.plannedMinor);
    expect(plan.boughtActualMinor + plan.notPlannedMinor).toBe(plan.spentMinor);
  });
});

describe('lines', () => {
  const plan = eventPlan(newborn());

  it('is one line per category, biggest plan first, and a category is only the sum of its items', () => {
    expect(plan.lines.map((line) => [line.name, line.plannedMinor, line.actualMinor])).toEqual([
      ['Baby gear', 26_000_000, 8_100_000],
      ['Hospital', 21_000_000, 3_450_000],
      ['Clothes', 2_200_000, 1_280_000],
    ]);
    expect(plan.lines[0]).toMatchObject({ categoryId: 'gear', planned: true, itemCount: 3, boughtCount: 1, purchaseCount: 2 });
  });

  it('puts what is still to buy before what is bought, and the extras last', () => {
    const gear = plan.lines[0]!;
    expect(gear.items.map((row) => [row.name, row.bought])).toEqual([
      ['Stroller Bugaboo', false],
      ['Car seat', false],
      ['Crib', true],
    ]);
    expect(gear.unplanned.map((row) => [row.description, row.partial])).toEqual([['Bottle steriliser', false]]);
    expect(gear.unplannedMinor).toBe(900_000);
  });

  it('gives a bought item its share, where and when, and the difference', () => {
    const crib = plan.lines[0]!.items[2]!;
    expect(crib).toMatchObject({
      bought: true,
      estimateMinor: 7_500_000,
      actualMinor: 7_200_000,
      occurredOn: '2026-09-12',
      description: 'Toko Bayi',
      differenceMinor: -300_000,
    });
    expect(plan.lines[0]!.items[0]).toMatchObject({ bought: false, estimateMinor: 12_000_000, actualMinor: null, occurredOn: null, differenceMinor: null });
  });

  it('files items with no category on a line of their own, always last', () => {
    const plan = eventPlan(newborn({ items: [item('i1', 'Cash for the midwife', 1, 2_000_000, null), item('i2', 'Crib', 1, 7_500_000, 'gear')], actuals: [] }));
    expect(plan.lines.map((line) => line.categoryId)).toEqual(['gear', null]);
    expect(plan.lines[1]).toMatchObject({ name: 'No category', plannedMinor: 2_000_000 });
  });

  it('names a category it has no name for by its id', () => {
    expect(eventPlan(newborn({ categoryNames: {} })).lines[0]!.name).toBe('gear');
  });
});

describe('one receipt, several items', () => {
  // Mothercare, Rp4.150.000: clothes, wraps and a steriliser, with Rp1.270.000 left on it.
  const plan = eventPlan({
    categoryNames: NAMES,
    items: [
      item('c1', 'Newborn clothes', 10, 150_000, 'clothes', { transactionId: 'm1', shareMinor: 1_280_000 }),
      item('c2', 'Muslin wraps', 4, 175_000, 'clothes', { transactionId: 'm1', shareMinor: 700_000 }),
      item('c3', 'Bottle steriliser', 1, 800_000, 'gear', { transactionId: 'm1', shareMinor: 900_000 }),
    ],
    actuals: [actual('m1', 'clothes', 4_150_000, '2026-09-14', 'Mothercare')],
  });

  it('gives each item its share of the one payment', () => {
    expect(plan.boughtActualMinor).toBe(2_880_000);
    expect(plan.lines.flatMap((line) => line.items).map((row) => [row.name, row.actualMinor])).toEqual([
      ['Newborn clothes', 1_280_000],
      ['Muslin wraps', 700_000],
      ['Bottle steriliser', 900_000],
    ]);
    expect(plan.boughtCount).toBe(3);
  });

  it('leaves what is left on the receipt as not-planned spending in its category', () => {
    expect(plan.notPlannedMinor).toBe(1_270_000);
    const clothes = plan.lines.find((line) => line.categoryId === 'clothes')!;
    expect(clothes.unplanned).toEqual([{ transactionId: 'm1', occurredOn: '2026-09-14', description: 'Mothercare', amountBaseMinor: 1_270_000, partial: true }]);
    // The money is read where it was spent; the steriliser was planned under Baby gear, so nothing is there.
    expect(clothes.actualMinor).toBe(4_150_000);
    expect(plan.lines.find((line) => line.categoryId === 'gear')).toMatchObject({ actualMinor: 0, unplannedMinor: 0 });
  });

  it('still keeps both invariants', () => {
    expect(plan.toBuyMinor + plan.boughtEstimateMinor).toBe(plan.plannedMinor);
    expect(plan.boughtActualMinor + plan.notPlannedMinor).toBe(plan.spentMinor);
  });

  it('files a leftover under the largest entry when the payment was split', () => {
    const split = eventPlan({
      categoryNames: NAMES,
      items: [item('c1', 'Newborn clothes', 1, 1_500_000, 'clothes', { transactionId: 'm1', shareMinor: 1_280_000 })],
      actuals: [actual('m1', 'clothes', 1_000_000, '2026-09-14', 'Mothercare'), actual('m1', 'gear', 2_000_000, '2026-09-14', 'Mothercare')],
    });
    expect(split.notPlannedMinor).toBe(1_720_000);
    expect(split.lines.find((line) => line.categoryId === 'gear')!.unplanned).toEqual([
      { transactionId: 'm1', occurredOn: '2026-09-14', description: 'Mothercare', amountBaseMinor: 1_720_000, partial: true },
    ]);
    expect(split.lines.find((line) => line.categoryId === 'clothes')!.unplanned).toEqual([]);
  });
});

describe('a plan is per category', () => {
  // Bali: three categories of spending nobody planned, and one planned category with nothing spent in it yet.
  const bali = eventPlan({
    categoryNames: { hotels: 'Hotels', food: 'Restaurants', taxi: 'Transport', fun: 'Activities' },
    items: [item('a1', 'Museum and theme park tickets', 4, 875_000, 'fun')],
    actuals: [
      actual('h1', 'hotels', 9_200_000, '2026-08-03', 'Hotel Uluwatu'),
      actual('r1', 'food', 4_300_000, '2026-08-04', 'Warung Babi Guling'),
      actual('t1', 'taxi', 4_900_000, '2026-08-05', 'Grab'),
    ],
  });

  it('plans only what was planned, and never pretends to cover the rest', () => {
    expect(bali).toMatchObject({ hasPlan: true, plannedMinor: 3_500_000, spentMinor: 18_400_000, toBuyMinor: 3_500_000, notPlannedMinor: 18_400_000 });
    // The chart measures this, not the 18.4m: nothing was ever planned for the food, so nothing is over.
    expect(bali.plannedSpentMinor).toBe(0);
    expect(bali.unplannedCategoryCount).toBe(3);
  });

  it('marks each line planned or not, with the planned one first', () => {
    expect(bali.lines.map((line) => [line.name, line.planned, line.purchaseCount])).toEqual([
      ['Activities', true, 0],
      ['Hotels', false, 1],
      ['Transport', false, 1],
      ['Restaurants', false, 1],
    ]);
  });

  it('keeps both invariants when only one category is planned', () => {
    expect(bali.toBuyMinor + bali.boughtEstimateMinor).toBe(bali.plannedMinor);
    expect(bali.boughtActualMinor + bali.notPlannedMinor).toBe(bali.spentMinor);
  });
});

describe('an event with no plan', () => {
  const plan = eventPlan(newborn({ items: [] }));

  it('reads as it does today: what was tagged, grouped by category', () => {
    expect(plan).toMatchObject({ hasPlan: false, plannedMinor: 0, plannedSpentMinor: 0, toBuyMinor: 0, differenceMinor: 0, unplannedCategoryCount: 3 });
    expect(plan.spentMinor).toBe(12_830_000);
    expect(plan.notPlannedMinor).toBe(12_830_000);
    expect(plan.lines.map((line) => [line.name, line.actualMinor, line.purchaseCount])).toEqual([
      ['Baby gear', 8_100_000, 2],
      ['Hospital', 3_450_000, 1],
      ['Clothes', 1_280_000, 1],
    ]);
  });

  it('has nothing at all when nothing was tagged either', () => {
    expect(eventPlan({ items: [], actuals: [], categoryNames: {} })).toMatchObject({ hasPlan: false, spentMinor: 0, purchaseCount: 0, lines: [] });
  });
});

describe('the awkward cases', () => {
  it('reads an item whose purchase is out of this scope as still to buy', () => {
    // What a workspace tab hands in: the item is here, its purchase is filed in the other workspace.
    const plan = eventPlan({ categoryNames: NAMES, items: [item('i3', 'Crib', 1, 7_500_000, 'gear', { transactionId: 't1', shareMinor: 7_200_000 })], actuals: [] });
    expect(plan).toMatchObject({ boughtCount: 0, toBuyMinor: 7_500_000, spentMinor: 0, notPlannedMinor: 0, differenceMinor: 0 });
    expect(plan.lines[0]!.items[0]).toMatchObject({ bought: false, actualMinor: null });
  });

  it('calls a purchase for exactly the estimate neither over nor under', () => {
    const plan = eventPlan({
      categoryNames: NAMES,
      items: [item('i1', 'Crib', 1, 7_500_000, 'gear', { transactionId: 't1', shareMinor: 7_500_000 })],
      actuals: [actual('t1', 'gear', 7_500_000, '2026-09-12', 'Toko Bayi')],
    });
    expect(plan).toMatchObject({ differenceMinor: 0, overCount: 0, notPlannedMinor: 0 });
    expect(plan.lines[0]!.items[0]!.differenceMinor).toBe(0);
  });
});
