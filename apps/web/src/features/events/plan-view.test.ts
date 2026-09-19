import { eventPlan, type EventPlanInput } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  afterSaving,
  answeredElsewhere,
  BACK_WORDS,
  chartUnder,
  coverTotals,
  differenceWords,
  eventListLine,
  gaugeFor,
  itemFormGate,
  itemSubline,
  moneyBackRows,
  moneyBackUnder,
  planCardRows,
  plannedLabel,
  PLAN_WORDS,
  planTotals,
  quantityWords,
  spentLabel,
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

  /*
   * The two totals one swipe apart: the ring adds up 7.8m — the planned categories — while the chart behind it adds
   * up all 12.8m tagged to the event. Both are true, and a user meeting them unlabelled has found two totals for one
   * trip. So the ring's own figure is named for what it counts whenever the two differ, and is plainly "Spent" when
   * there is only one total to have.
   */
  it('names the middle figure for what it counts when that is not the whole event', () => {
    const partly = withFood();
    expect(partly.spentMinor).toBe(12_800_000);
    expect(gaugeFor(partly).spentMinor).toBe(7_800_000);
    expect(spentLabel(partly)).toBe('Spent on plan');
    // Nothing outside the plan, so the ring's figure is the whole event's and needs no qualifying.
    expect(plan.spentMinor).toBe(gaugeFor(plan).spentMinor);
    expect(spentLabel(plan)).toBe('Spent');
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
    expect(line).toMatchObject({ amountMinor: 7_800_000, ofMinor: 20_200_000, backLine: null });
    expect(eventListLine(eventPlan({ ...input, items: [] }))).toEqual({
      subline: 'No plan · 1 purchase',
      amountMinor: 7_800_000,
      ofMinor: null,
      backLine: null,
    });
  });

  /*
   * The branch's headline guarantee, on the one surface that had no test for it.
   *
   * The fixture above is planned end to end, so `plannedSpentMinor` and `spentMinor` are the same figure there and
   * the card passed against either. They part company the moment a category has money and no items — which is the
   * whole case §5.6 exists for — and then reading the wrong one puts "Rp 12.800.000 of Rp 20.200.000" on a card
   * whose plan is genuinely under, with the bar beside it red. So the two are pinned apart first, and the card is
   * read against the one that belongs to the plan.
   */
  it('measures a partly-planned event against its plan, never against the whole trip', () => {
    const partly = withFood();
    expect(partly.spentMinor).toBe(12_800_000);
    expect(partly.plannedSpentMinor).toBe(7_800_000);
    const line = eventListLine(partly);
    expect(line).toMatchObject({ amountMinor: 7_800_000, ofMinor: 20_200_000 });
    // And so the card reads as under its plan, which is the truth about it.
    expect(line.amountMinor).toBeLessThan(line.ofMinor!);
  });
});

/*
 * The card on the events list, when an event's only money came back.
 *
 * Reachable the moment a refund is tagged to an event whose purchase never was, and the card is the one surface
 * that had no clamp: it printed −Rp1.000.000 beside a bar drawn from a negative. Clamping it in the screen would
 * only have hidden it, so the figure comes back clamped and what the clamp swallowed comes back beside it, named
 * for the figure it explains — the whole event's when the card reads the whole event, the ring's when it reads the
 * plan. Never a negative, and never a silence either.
 */
describe('an event whose card would read below nought', () => {
  const crib = { id: 'g1', name: 'Crib', quantity: 1, unitPriceMinor: 5_000_000, categoryId: 'gear', link: null, note: null, purchase: null };
  const givenBack = (items: EventPlanInput['items']) =>
    eventPlan({
      categoryNames: { gear: 'Baby gear' },
      items,
      actuals: [{ transactionId: 'g1', occurredOn: '2026-09-13', description: 'Toko Bayi refund', categoryId: 'gear', amountBaseMinor: -1_000_000 }],
    });

  it('clamps the figure the card prints, and hands back what the clamp swallowed', () => {
    const unplanned = givenBack([]);
    // The raw figure, so the clamp has something real to bite on.
    expect(unplanned.spentMinor).toBe(-1_000_000);
    const line = eventListLine(unplanned);
    expect(line).toMatchObject({ amountMinor: 0, ofMinor: null });
    expect(plain(line.backLine!)).toBe('Rp 1.000.000 more came back than went out');
  });

  it('names the plan’s own shortfall when the card is reading the plan', () => {
    const planned = givenBack([crib]);
    expect(planned.plannedSpentMinor).toBe(-1_000_000);
    const line = eventListLine(planned);
    expect(line).toMatchObject({ amountMinor: 0, ofMinor: 5_000_000 });
    expect(plain(line.backLine!)).toBe('Rp 1.000.000 more came back than the plan spent');
    // Nothing is still to buy any less for a refund: the subline is the plan's, in full.
    expect(plain(line.subline)).toBe('Planned · Rp 5.000.000 still to buy');
  });
});

describe('what a new item does', () => {
  it('shows the event, what is left to buy, and what is still unclaimed', () => {
    expect(afterSaving(plan, { estimateMinor: 6_500_000 })).toEqual({ plannedMinor: 26_700_000, toBuyMinor: 19_200_000, notPlannedMinor: 0, moneyBackMinor: 0 });
  });

  it('takes the old estimate out first when an item is being edited', () => {
    expect(afterSaving(plan, { estimateMinor: 14_000_000, replacing: 'i1' })).toMatchObject({ plannedMinor: 22_200_000, toBuyMinor: 14_700_000 });
  });

  it('does not put a bought item back on the list when its price each is edited', () => {
    expect(afterSaving(plan, { estimateMinor: 8_000_000, replacing: 'i2' })).toMatchObject({ plannedMinor: 20_700_000, toBuyMinor: 12_700_000 });
  });

  it('is the plan as it stands while nothing has been typed', () => {
    expect(afterSaving(plan, { estimateMinor: 0 })).toEqual({ plannedMinor: 20_200_000, toBuyMinor: 12_700_000, notPlannedMinor: 0, moneyBackMinor: 0 });
  });
});

describe('what a receipt covers', () => {
  it('adds up what has been given out and what is left', () => {
    expect(coverTotals(4_150_000, [1_280_000, 700_000, 900_000])).toEqual({ totalMinor: 4_150_000, givenMinor: 2_880_000, leftMinor: 1_270_000, over: false });
    expect(coverTotals(1_500_000, [1_280_000, 700_000])).toMatchObject({ leftMinor: -480_000, over: true });
  });

  /*
   * The boundary the Save button hangs on, one minor unit either side of it.
   *
   * A receipt whose shares come to exactly what it cost is the *ordinary* save — a shopping trip in which every
   * rupiah answered something — so `over` at `>=` would turn Save off on the commonest thing this screen is for,
   * and nothing above would notice: 4.150.000 out of 4.150.000 leaves nought, which is what `leftMinor` says either
   * way. Only the flag parts them, so only the flag is asserted at the three figures around the edge.
   */
  it('calls the exactly-covered receipt covered, and one unit more over', () => {
    expect(coverTotals(4_150_000, [2_200_000, 1_950_000])).toEqual({ totalMinor: 4_150_000, givenMinor: 4_150_000, leftMinor: 0, over: false });
    expect(coverTotals(4_150_000, [2_200_000, 1_950_001])).toMatchObject({ leftMinor: -1, over: true });
    expect(coverTotals(4_150_000, [2_200_000, 1_949_999])).toMatchObject({ leftMinor: 1, over: false });
    // Nothing ticked at all is not over either: it is a receipt nobody has claimed yet.
    expect(coverTotals(4_150_000, [])).toMatchObject({ givenMinor: 0, leftMinor: 4_150_000, over: false });
  });
});

/*
 * The plan's vocabulary, which is the one thing separating this gauge from the Budget page's.
 *
 * The same `BudgetGauge` draws both, handed either `MONTH_WORDS` or `PLAN_WORDS`; a card that reverted to the
 * month's would say "Over budget by" and "3 budgets over" on a trip, with every figure still correct. So each word
 * is pinned, and the whole set is checked to carry none of the month's — a budget is a monthly cap, a plan is a
 * list of things to buy, and "RAB" is nowhere in this app at all.
 */
describe('the words a plan is read in', () => {
  it('is the plan’s own vocabulary and never the month’s', () => {
    expect(PLAN_WORDS.left).toBe('Left of the plan');
    expect(PLAN_WORDS.over).toBe('Over the plan by');
    expect(PLAN_WORDS.set).toBe('Planned');
    expect(PLAN_WORDS.spent).toBe('Spent');
    expect(PLAN_WORDS.overCount(1)).toBe('1 item over');
    expect(PLAN_WORDS.overCount(3)).toBe('3 items over');
  });

  /*
   * The sweep, over everything this module can put in front of a user — and not over the six words above it.
   *
   * Sweeping only `PLAN_WORDS` was a test that could not fail: the six assertions above pin each of those words to
   * a literal, so no mutation reaches the sweep that has not already failed twice. What the sweep is *for* is the
   * word nobody thought to pin — a label computed rather than declared, a sentence added to this file next month —
   * so it gathers every string the module hands a screen, across fixtures chosen to make each branch speak, and
   * checks the count so it cannot quietly degenerate into sweeping the same word ten times.
   */
  it('says everything in the plan’s own words, including the ones no assertion names', () => {
    const said = [
      ...Object.values(PLAN_WORDS).flatMap((word) => (typeof word === 'function' ? [word(1), word(3)] : [word])),
      ...Object.values(BACK_WORDS),
      ...[plan, withFood(), refunded].flatMap((each) => [
        plannedLabel(each),
        spentLabel(each),
        eventListLine(each).subline,
        eventListLine(each).backLine ?? '',
        chartUnder(planTotals(each), 2) ?? '',
      ]),
      ...[plan.lines[0]!.items[0]!, plan.lines[0]!.items[1]!].map((item) => itemSubline(item)),
      differenceWords(450_000).text,
      differenceWords(-220_000).text,
      differenceWords(0).text,
      moneyBackUnder(1_000_000, []) ?? '',
      moneyBackUnder(1_000_000, [{ amountMinor: 400_000 }]) ?? '',
      moneyBackUnder(400_000, [{ amountMinor: 600_000 }]) ?? '',
      answeredElsewhere(plan.lines[0]!.items[1]!, 'somewhere-else') ?? '',
    ].filter((word) => word !== '');
    // A sweep over one word repeated is no sweep at all.
    expect(new Set(said).size).toBeGreaterThanOrEqual(16);
    for (const word of said) expect(word).not.toMatch(/budget|cap\b|RAB/i);
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
      spentMinor: 2_000_000,
      plannedSpentMinor: 2_000_000,
      wentOutMinor: 2_000_000,
      cameBackMinor: 0,
      netBackMinor: 0,
      planNetBackMinor: 0,
      notPlannedMinor: 0,
      moneyBackMinor: 1_000_000,
    });
  });

  it('leaves an ordinary plan’s figures exactly as they are', () => {
    expect(planTotals(sharedPlan)).toEqual({
      plannedMinor: 14_200_000,
      boughtActualMinor: 1_980_000,
      toBuyMinor: 12_000_000,
      spentMinor: 4_770_000,
      plannedSpentMinor: 4_150_000,
      wentOutMinor: 4_770_000,
      cameBackMinor: 0,
      netBackMinor: 0,
      planNetBackMinor: 0,
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
    // Editing the crib down to 1.000.000 leaves nothing still to buy and nothing unplanned to show — but the
    // 1.000.000 that came back is still the event's, and the form says so rather than dropping it.
    expect(afterSaving(refunded, { estimateMinor: 1_000_000, replacing: 'r1' })).toEqual({
      plannedMinor: 1_000_000,
      toBuyMinor: 0,
      notPlannedMinor: 0,
      moneyBackMinor: 1_000_000,
    });
    // Mid-keystroke the estimate is nought, and a plan of nothing is still not a plan of less than nothing.
    expect(afterSaving(refunded, { estimateMinor: 0, replacing: 'r1' })).toMatchObject({ plannedMinor: 0, toBuyMinor: 0 });
  });

  /*
   * The case the fixture above cannot reach: a refund *alongside* ordinary unplanned spending.
   *
   * With a refund as the event's only unplanned money, "what the clamp swallowed" and "what came back" are the same
   * number, and a test built on that fixture passes against either definition. They part company the moment
   * something else is unplanned too, and then one of them is wrong on screen — so both orders of magnitude are
   * checked here, and each line is asserted to equal the sum of the rows printed beneath it rather than a literal
   * reached by the same subtraction the code makes.
   */
  const alongside = (refundMinor: number, unplannedMinor: number) =>
    eventPlan({
      categoryNames: { gear: 'Baby gear', food: 'Restaurants' },
      items: [{ id: 'a1', name: 'Crib', quantity: 1, unitPriceMinor: 3_000_000, categoryId: 'gear', link: null, note: null, purchase: { transactionId: 'p1', shareMinor: 3_000_000 } }],
      actuals: [
        { transactionId: 'p1', occurredOn: '2026-09-12', description: 'Toko Bayi', categoryId: 'gear', amountBaseMinor: 3_000_000 },
        { transactionId: 'p2', occurredOn: '2026-09-13', description: 'Toko Bayi refund', categoryId: 'gear', amountBaseMinor: -refundMinor },
        { transactionId: 'p3', occurredOn: '2026-09-14', description: 'Hampers', categoryId: 'food', amountBaseMinor: unplannedMinor },
      ],
    });

  /** What `moneyBackRows` is handed on the page: the same transactions, as the history lists them. */
  const asHistory = (refundMinor: number, unplannedMinor: number) => [
    { id: 'p1', occurredOn: '2026-09-12', description: 'Toko Bayi', entries: [{ accountKind: 'expense', amountBaseMinor: 3_000_000 }] },
    { id: 'p2', occurredOn: '2026-09-13', description: 'Toko Bayi refund', entries: [{ accountKind: 'expense', amountBaseMinor: -refundMinor }] },
    { id: 'p3', occurredOn: '2026-09-14', description: 'Hampers', entries: [{ accountKind: 'expense', amountBaseMinor: unplannedMinor }] },
  ];

  const bothWaysRound: [string, number, number][] = [
    ['the refund is the smaller', 1_000_000, 5_000_000],
    ['the refund is the larger', 1_500_000, 800_000],
  ];

  it.each(bothWaysRound)('each heading is the sum of its own rows when %s', (_case, refundMinor, unplannedMinor) => {
    const plan = alongside(refundMinor, unplannedMinor);
    const totals = planTotals(plan);
    const leftovers = plan.lines.flatMap((line) => line.unplanned);
    const back = moneyBackRows(asHistory(refundMinor, unplannedMinor));

    // The rows the screen prints, by hand: the hampers are nobody's item, the refund is the only money coming back.
    expect(leftovers.map((row) => [row.description, row.amountBaseMinor])).toEqual([['Hampers', unplannedMinor]]);
    expect(back.map((row) => [row.description, row.amountMinor])).toEqual([['Toko Bayi refund', refundMinor]]);

    // Each figure equals the rows under it — the one thing a user can check, and the thing the old definition broke:
    // it read notPlanned 4.000.000 over rows of 5.000.000, and money back 700.000 over a row of 1.500.000.
    expect(totals.notPlannedMinor).toBe(leftovers.reduce((total, row) => total + row.amountBaseMinor, 0));
    expect(totals.moneyBackMinor).toBe(back.reduce((total, row) => total + row.amountMinor, 0));
    expect(totals.notPlannedMinor).toBe(unplannedMinor);
    expect(totals.moneyBackMinor).toBe(refundMinor);

    // And the account still closes over the two, with every figure at or above nought.
    expect(plan.spentMinor).toBe(3_000_000 - refundMinor + unplannedMinor);
    expect(plan.spentMinor).toBe(totals.boughtActualMinor + totals.notPlannedMinor - totals.moneyBackMinor);
    for (const figure of Object.values(totals)) expect(figure).toBeGreaterThanOrEqual(0);
    // The hampers are in a category with no items, so the plan does not claim to be the whole account of the money.
    expect(plannedLabel(plan)).toBe('Planned so far');
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

/*
 * An event that got more back than it ever spent.
 *
 * Reachable the moment a refund is tagged to an event whose original purchase never was — a receipt handed back on
 * a trip somebody tagged on the way home. Spending is then below nought, and three figures on one page each used to
 * answer for it separately: the chart's middle printed the negative, the row under the ring meant to quote that
 * chart printed a clamped Rp0, and the ring's own middle printed the negative again beside a Plan card printing
 * nought. One quantity, two answers, on the very page built to reconcile them.
 *
 * The rule is both-sided — never show a negative, never hide one either — so every figure comes back through
 * `planTotals` and what each clamp swallowed comes back with it, to be said in the page's own words for money
 * coming back. Both arrangements are built: the refund in a category the plan never names, and the refund in a
 * category it does, which is the one that drove the ring itself under.
 */
describe('an event whose refunds outran it', () => {
  const crib = { id: 'n1', name: 'Crib', quantity: 1, unitPriceMinor: 5_000_000, categoryId: 'gear', link: null, note: null, purchase: null };
  const netNegative = (categoryId: string) =>
    eventPlan({
      categoryNames: { gear: 'Baby gear', food: 'Restaurants' },
      items: [crib],
      actuals: [
        { transactionId: 'q1', occurredOn: '2026-09-12', description: 'Hampers', categoryId, amountBaseMinor: 2_000_000 },
        { transactionId: 'q2', occurredOn: '2026-09-13', description: 'Toko Bayi refund', categoryId, amountBaseMinor: -3_000_000 },
      ],
    });
  /** The refund lands where no item is: the event nets −1.000.000 while the planned categories spent nothing. */
  const outsidePlan = netNegative('food');
  /** The refund lands in the one category that has items, so the ring's own figure goes under with the event's. */
  const insidePlan = netNegative('gear');

  it('is genuinely below nought before anything on screen reads it', () => {
    // The raw figures, by hand from the fixtures, so every clamp below has something real to bite on.
    expect(outsidePlan.spentMinor).toBe(-1_000_000);
    expect(outsidePlan.plannedSpentMinor).toBe(0);
    expect(insidePlan.spentMinor).toBe(-1_000_000);
    expect(insidePlan.plannedSpentMinor).toBe(-1_000_000);
  });

  it('hands both screens one clamped total each, and says what each clamp swallowed', () => {
    expect(planTotals(outsidePlan)).toEqual({
      plannedMinor: 5_000_000,
      boughtActualMinor: 0,
      toBuyMinor: 5_000_000,
      spentMinor: 0,
      plannedSpentMinor: 0,
      // Nothing went out anywhere: both categories net below nought, so the ring has no slice to draw at all.
      wentOutMinor: 0,
      cameBackMinor: 1_000_000,
      netBackMinor: 1_000_000,
      // The planned categories spent nothing at all, which is a nought nobody clamped and nothing to explain.
      planNetBackMinor: 0,
      notPlannedMinor: 2_000_000,
      moneyBackMinor: 3_000_000,
    });
    expect(planTotals(insidePlan)).toEqual({
      plannedMinor: 5_000_000,
      boughtActualMinor: 0,
      toBuyMinor: 5_000_000,
      spentMinor: 0,
      plannedSpentMinor: 0,
      // Nothing went out anywhere: both categories net below nought, so the ring has no slice to draw at all.
      wentOutMinor: 0,
      cameBackMinor: 1_000_000,
      netBackMinor: 1_000_000,
      planNetBackMinor: 1_000_000,
      notPlannedMinor: 2_000_000,
      moneyBackMinor: 3_000_000,
    });
    for (const plan of [outsidePlan, insidePlan]) for (const figure of Object.values(planTotals(plan))) expect(figure).toBeGreaterThanOrEqual(0);
  });

  /*
   * The arc drew `formatMinor(spentMinor)` straight off the plan, so this read "Spent −Rp1.000.000" — a negative on
   * screen — while the Plan card a few lines below clamped the same quantity to Rp0 for itself. Both go through
   * `planTotals` now, so the two cannot be given different answers to give.
   */
  it('never draws the ring’s own middle below nought, and draws the Plan card’s header figure', () => {
    expect(gaugeFor(insidePlan)).toEqual({ capsMinor: 5_000_000, spentMinor: 0, overCount: 0, any: true });
    expect(gaugeFor(insidePlan).spentMinor).toBe(planTotals(insidePlan).plannedSpentMinor);
    expect(gaugeFor(outsidePlan).spentMinor).toBe(planTotals(outsidePlan).plannedSpentMinor);
    // And what is left of the plan is the whole plan: a refund cannot leave more of a plan than the plan holds.
    expect(gaugeFor(insidePlan).capsMinor - gaugeFor(insidePlan).spentMinor).toBe(5_000_000);
  });

  it('says under the chart how much more came back than went out', () => {
    expect(plain(chartUnder(planTotals(insidePlan), 2)!)).toBe('2 transactions · Rp 1.000.000 more came back than went out');
    // An ordinary event is unchanged: the line is what it always was, and no clamp is claimed where none happened.
    expect(chartUnder(planTotals(sharedPlan), 2)).toBe('2 transactions');
    expect(chartUnder(planTotals(sharedPlan), 1)).toBe('1 transaction');
    expect(chartUnder(planTotals(sharedPlan), 0)).toBeUndefined();
  });

  it('names what came back rather than a total, and says so in this page’s own words', () => {
    expect(BACK_WORDS.event).toBe('More came back than went out');
    expect(BACK_WORDS.plan).toBe('More came back than the plan spent');
  });
});

/*
 * The ring on "Where it went", and the whole its slices are a share of.
 *
 * Each slice is a category clamped at nought — nothing draws a share of less than nothing — but the whole they were
 * drawn against was the event's *net*, so a refund landing in one category while another spent gave the spending
 * category a slice longer than the ring: Travel Rp5.000.000 at 125 % of a ring whose middle read Rp4.000.000. Two
 * numbers for one quantity, on the page whose job is to reconcile them. The whole is what went out; what came back
 * is handed back beside it, because a figure a clamp swallowed has to be said somewhere.
 */
describe('the ring on "Where it went"', () => {
  /** Travel spends, Hotels refunds: the arrangement in which the net is not what the slices add up to. */
  const split = eventPlan({
    categoryNames: { travel: 'Travel', hotels: 'Hotels' },
    items: [{ id: 'w1', name: 'Flights', quantity: 1, unitPriceMinor: 6_000_000, categoryId: 'travel', link: null, note: null, purchase: null }],
    actuals: [
      { transactionId: 'w1', occurredOn: '2026-09-12', description: 'Garuda', categoryId: 'travel', amountBaseMinor: 5_000_000 },
      { transactionId: 'w2', occurredOn: '2026-09-13', description: 'Hotel refund', categoryId: 'hotels', amountBaseMinor: -1_000_000 },
    ],
  });

  it('is drawn against what went out, so no slice can be longer than the ring', () => {
    const totals = planTotals(split);
    // By hand: Rp5.000.000 out of Travel, Rp1.000.000 back out of Hotels, and the event nets Rp4.000.000.
    expect(split.spentMinor).toBe(4_000_000);
    expect(totals.wentOutMinor).toBe(5_000_000);
    expect(totals.cameBackMinor).toBe(1_000_000);
    // The slices the screen draws, clamped as it clamps them, against the whole it now hands the ring.
    const slices = whereItWentRows(split).map((row) => Math.max(0, row.actualMinor));
    expect(slices).toEqual([5_000_000, 0]);
    expect(slices.reduce((total, part) => total + part, 0)).toBe(totals.wentOutMinor);
    for (const part of slices) expect(part).toBeLessThanOrEqual(totals.wentOutMinor);
    // Against the net it was 125 %; against what went out it is the whole ring and no more.
    expect(Math.round((slices[0]! / totals.wentOutMinor) * 100)).toBe(100);
  });

  it('closes over the middle figure: what went out less what came back is what the event spent', () => {
    for (const each of [split, sharedPlan, refunded]) {
      const totals = planTotals(each);
      expect(totals.wentOutMinor - totals.cameBackMinor).toBe(each.spentMinor);
    }
  });

  it('says under the ring what the slices cannot draw', () => {
    // Nothing is clamped on the event's own total here, so the old line said only "3 transactions" and the
    // Rp1.000.000 gap between the ring and its middle was left for the reader to find.
    expect(planTotals(split).netBackMinor).toBe(0);
    expect(plain(chartUnder(planTotals(split), 3)!)).toBe('3 transactions · Rp 1.000.000 came back');
    // And an ordinary event says nothing of the sort.
    expect(chartUnder(planTotals(sharedPlan), 3)).toBe('3 transactions');
  });
});

/*
 * The heading over the "Money back" rows, and the rows themselves — two readings of one event.
 *
 * The heading is the plan's own subtraction, narrowed by the category an entry is filed in; the rows are the
 * transactions the history lists, narrowed by the workspace a transaction is filed in and cut off at that list's own
 * limit. Where the two differ the heading stands over rows that do not come to it, and adding the rows up is the one
 * check a user has. Saying so only when the rows were *entirely* gone left the commoner case silently wrong.
 */
describe('whether the money-back rows add up to their heading', () => {
  it('says nothing at all when they do', () => {
    expect(moneyBackUnder(1_000_000, [{ amountMinor: 600_000 }, { amountMinor: 400_000 }])).toBeNull();
    expect(moneyBackUnder(0, [])).toBeNull();
  });

  it('names the shortfall when the rows are short, not only when they are gone', () => {
    expect(plain(moneyBackUnder(1_000_000, [{ amountMinor: 600_000 }])!)).toBe(
      'These rows come to Rp 600.000. The rest came back on payments this list does not reach.',
    );
    expect(moneyBackUnder(1_000_000, [])).toBe('More came back than any item accounts for.');
  });

  /*
   * The other direction is a different sentence, not the same one turned round. When the rows come to more than the
   * heading there is no "rest" to go looking for — the rows are the larger reading and the unaccounted-for money is
   * on the heading's side of the gap. Sending the user off to find payments "this list does not reach" while the
   * list is showing more than the heading is the one thing the sentence must not do.
   */
  it('says so the other way round too, when the rows come to more than the heading', () => {
    expect(plain(moneyBackUnder(400_000, [{ amountMinor: 600_000 }])!)).toBe(
      'These rows come to Rp 600.000, more than the figure above. The difference is money the figure above does not count.',
    );
    expect(moneyBackUnder(400_000, [{ amountMinor: 600_000 }])).not.toMatch(/the rest/i);
    expect(moneyBackUnder(400_000, [{ amountMinor: 600_000 }])).not.toMatch(/does not reach/i);
  });
});

/*
 * A row on "What it covers" whose item is already answered by a different receipt.
 *
 * Ticking it here re-points the item and takes its money with it — often exactly what is meant, since the wrong
 * receipt gets picked and receipts get corrected. What was wrong is that it happened in silence: the row said the
 * item's estimate and its category and nothing about where its money actually was.
 */
describe('an item another receipt already answers', () => {
  it('says which payment holds it, and that ticking it here moves it', () => {
    const crib = plan.lines[0]!.items[1]!;
    expect(crib.purchase!.transactionId).toBe('t1');
    expect(answeredElsewhere(crib, 't2')).toBe('answered by Toko Bayi · 12 Sep — ticking it here moves it');
    // On its own receipt there is nothing to move and nothing to say.
    expect(answeredElsewhere(crib, 't1')).toBeNull();
    // An item nothing has answered yet is the ordinary row.
    expect(answeredElsewhere(plan.lines[0]!.items[0]!, 't1')).toBeNull();
  });

  it('still says it when the purchase sits outside the reading, where its description is not known', () => {
    // A tab, or a workspace, can put the answering receipt out of scope: `bought` is false and the description is
    // null, and the one thing still true — that something else holds this item — is the thing that must be said.
    const elsewhere = eventPlan({
      categoryNames: { gear: 'Baby gear' },
      items: [{ id: 'e1', name: 'Crib', quantity: 1, unitPriceMinor: 3_000_000, categoryId: 'gear', link: null, note: null, purchase: { transactionId: 'gone', shareMinor: 3_000_000 } }],
      actuals: [],
    });
    const item = elsewhere.lines[0]!.items[0]!;
    expect(item.bought).toBe(false);
    expect(answeredElsewhere(item, 't9')).toBe('answered by another payment — ticking it here moves it');
  });
});

/*
 * The item form's two gates, which are not the same gate.
 *
 * A copy of the data from before migration 0049 has no `event_items`, and a save against it is a no-op that still
 * hands back an id. The warning about that may only be drawn once the app has asked and been told No. Save may not
 * wait for a No: until the answer lands the app does not know, and that window — the first paint through one round
 * trip — is precisely where a save on such a copy would have looked like it worked, with no warning yet beside it.
 */
describe('what the item form may do while it is still asking whether it can keep an item', () => {
  it('keeps Save off until the answer arrives, and draws the warning only once the answer is no', () => {
    // Still asking: Save off, and nothing accused.
    expect(itemFormGate({ isSuccess: false })).toEqual({ blocked: false, saveOff: true });
    // Answered yes: an ordinary form.
    expect(itemFormGate({ isSuccess: true, data: true })).toEqual({ blocked: false, saveOff: false });
    // Answered no: both.
    expect(itemFormGate({ isSuccess: true, data: false })).toEqual({ blocked: true, saveOff: true });
  });
});
