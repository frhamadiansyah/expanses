import { formatMinor, type EventPlanItemView } from '@expanses/core';
import type { SharedEventView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { defaultPart, itemChanges, tickChoices } from './shared-plan';

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
