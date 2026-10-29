import { type EventPlan, formatMinor, type EventPlanItemView } from '@expanses/core';
import type { SharedEventView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { defaultPart, itemChanges, planSummary, sharedPlanHero, tickChoices } from './shared-plan';

/* An item of the shared plan, opened (D7, I10). Invented figures, in TRY. */

const item = (over: Partial<EventPlanItemView> = {}): EventPlanItemView =>
  ({
    id: 'i1', name: 'Boat tour', quantity: 2, unitPriceMinor: 75_000, categoryId: 'c-fun', link: null, note: 'Morning one', purchase: null, purchases: [], done: false, purchaseCount: 0,
    estimateMinor: 150_000, bought: false, actualMinor: null, occurredOn: null, description: null, boughtInCategoryId: null, differenceMinor: null, ...over,
  }) as EventPlanItemView;

const draft = { name: 'Boat tour', price: '750', expenseId: '', part: '' };

describe('an opened item of the shared plan', () => {
  it('ticks against the expenses not deleted', () => {
    const expense = { expenseId: 'e1', note: 'Harbour boat', categoryName: null, eventAmountMinor: 160_000, voided: false };
    const view = { currency: 'TRY', expenses: [expense, { ...expense, expenseId: 'e2', voided: true }] } as unknown as SharedEventView;
    expect(tickChoices(view)).toEqual([{ expenseId: 'e1', label: `Harbour boat · ${formatMinor(160_000, 'TRY')}`, eventAmountMinor: 160_000 }]);
  });

  it('offers the item’s estimate as its part, never more than the expense', () => {
    expect(defaultPart(item(), 160_000)).toBe(150_000);
    expect(defaultPart(item(), 90_000)).toBe(90_000);
  });

  it('writes nothing when nothing changed', () => {
    expect(itemChanges(item(), draft, 'TRY')).toEqual({ save: null, add: null });
  });

  it('saves a new price, keeping the rest of the item', () => {
    expect(itemChanges(item(), { ...draft, price: '80' }, 'TRY').save).toEqual({ id: 'i1', name: 'Boat tour', quantity: 2, unitPriceMinor: 8_000, categoryId: 'c-fun', link: null, note: 'Morning one' });
  });

  it('adds a payment, puts an existing one’s part right, and adds nothing when nothing was chosen', () => {
    expect(itemChanges(item(), { ...draft, expenseId: 'e1', part: '1500' }, 'TRY').add).toEqual({ expenseId: 'e1', shareMinor: 150_000 });
    const paid = item({ purchases: [{ transactionId: 'e1', shareMinor: 150_000 }] });
    expect(itemChanges(paid, { ...draft, expenseId: 'e1', part: '1500' }, 'TRY').add).toBeNull();
    expect(itemChanges(paid, { ...draft, expenseId: 'e1', part: '1400' }, 'TRY').add).toEqual({ expenseId: 'e1', shareMinor: 140_000 });
    expect(itemChanges(paid, { ...draft, expenseId: 'e2', part: '200' }, 'TRY').add).toEqual({ expenseId: 'e2', shareMinor: 20_000 });
    expect(itemChanges(paid, draft, 'TRY').add).toBeNull();
  });
});

describe('plan summary', () => {
  it('adds the list up and measures what was spent against it', () => {
    expect(planSummary([{ estimateMinor: 1_200 }, { estimateMinor: 800 }], 500)).toEqual({ plannedMinor: 2_000, leftMinor: 1_500, percent: 25 });
    expect(planSummary([{ estimateMinor: 100 }], 400)).toEqual({ plannedMinor: 100, leftMinor: 0, percent: 100 });
    expect(planSummary([], 400)).toEqual({ plannedMinor: 0, leftMinor: 0, percent: 0 });
  });
});

describe('the shared plan hero', () => {
  const plan = (items: EventPlanItemView[], boughtCount: number) =>
    ({
      lines: [{ items }],
      itemCount: items.length,
      boughtCount,
      plannedEventMinor: items.reduce((t, i) => t + i.estimateMinor, 0),
      toBuyEventMinor: items.filter((i) => !i.bought).reduce((t, i) => t + Math.max(0, i.estimateMinor - (i.paidEventMinor ?? 0)), 0),
      boughtActualEventMinor: items.reduce((t, i) => t + (i.paidEventMinor ?? 0), 0),
      unplannedCategoryCount: 0,
      missingRates: [],
    }) as unknown as EventPlan;
  const open = item({ estimateEventMinor: 150_000, paidEventMinor: null });
  const paid = item({ id: 'i2', estimateMinor: 100_000, estimateEventMinor: 100_000, paidEventMinor: 90_000, actualMinor: 90_000, purchaseCount: 1, bought: true, done: true });

  it('says nothing paid, with everything still to pay', () => {
    const hero = sharedPlanHero(plan([open], 0), 'TRY');
    expect(hero.status.kind).toBe('none');
    expect(hero.percent).toBe(0);
    expect(hero.count).toBe('0 of 1 paid');
    expect(hero.toPay).toBe(`${formatMinor(150_000, 'TRY')} to pay`);
    expect(hero.toPayBase).toBeNull();
  });

  it('reads a settled item under its estimate as a saving', () => {
    const hero = sharedPlanHero(plan([open, paid], 1), 'TRY');
    expect(hero.status).toEqual({ kind: 'saved', amount: formatMinor(10_000, 'TRY') });
    expect(hero.actual).toBe(formatMinor(90_000, 'TRY'));
    expect(hero.count).toBe('1 of 2 paid');
  });

  it('says All paid once every item is done', () => {
    expect(sharedPlanHero(plan([paid], 1), 'TRY').toPay).toBe('All paid');
  });
});
