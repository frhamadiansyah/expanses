import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { offeredCategories } from '../categories/offered';
import { newTransactionSearch } from '../transactions/new-search';
import { emptyForm, type FormDraft, formToPost, seeded } from '../transactions/tx-form';
import { type BuyingItem, buyRefusal, buySeed, eventOpening } from './buy-item';

/*
 * An event's Add spending, and a plan item's "Buy it now", open the ordinary Add screen with the event already set.
 *
 * The event page used to carry a small form of its own; these are the pieces that replace it, read in the order the
 * screen reads them: the address, what it names that this device actually holds, the fields that fills in, and the
 * one question asked before a purchase that is also an item is written.
 */

// Invented: a wallet, a card-free account in another currency, two spending categories and an income one.
const accounts = [
  { id: 'wallet', name: 'Dompet', kind: 'asset', subtype: 'cash', currency: 'IDR' },
  { id: 'usd', name: 'Travel USD', kind: 'asset', subtype: 'savings', currency: 'USD' },
  { id: 'cat-food', name: 'Food and beverage', kind: 'expense', subtype: 'category', currency: null },
  { id: 'cat-tiles', name: 'Tiles', kind: 'expense', subtype: 'category', currency: null },
  { id: 'cat-salary', name: 'Salary', kind: 'income', subtype: 'category', currency: null },
] as AccountRow[];

const crib: BuyingItem = { id: 'item-crib', name: 'Crib', estimateMinor: 6_400_000, categoryId: 'cat-tiles' };
const wraps: BuyingItem = { id: 'item-wraps', name: 'Muslin wraps', estimateMinor: 520_000, categoryId: null };

describe('the Add screen’s address', () => {
  it('reads an event and its item, and the plan’s tab', () => {
    expect(newTransactionSearch({ event: 'e1', item: 'i1', ws: 'b1' })).toEqual({ event: 'e1', item: 'i1', ws: 'b1' });
    expect(newTransactionSearch({ event: 'e1' })).toEqual({ event: 'e1' });
  });

  it('drops an item carried without its event, since the payment is tagged to the event before the item claims it', () => {
    expect(newTransactionSearch({ item: 'i1' })).toEqual({});
  });

  it('drops what is empty or not text, so nothing opens on the word "undefined" or a number', () => {
    expect(newTransactionSearch({ event: '', item: 'i1', ws: '' })).toEqual({});
    expect(newTransactionSearch({ event: 7, account: ['wallet'] })).toEqual({});
  });

  it('still reads what an account’s page sends', () => {
    expect(newTransactionSearch({ mode: 'transfer', account: 'wallet', to: 'usd' })).toEqual({ mode: 'transfer', account: 'wallet', to: 'usd' });
    expect(newTransactionSearch({ mode: 'gift' })).toEqual({});
  });
});

describe('what an address names that this device holds', () => {
  const events = [{ id: 'e1' }, { id: 'e2' }];

  it('opens on a known event, and on the item when it is on that event’s plan', () => {
    expect(eventOpening({ event: 'e1' }, events, [crib])).toEqual({ eventId: 'e1', item: null });
    expect(eventOpening({ event: 'e1', item: 'item-crib' }, events, [crib, wraps])).toEqual({ eventId: 'e1', item: crib });
  });

  it('ignores an event that is not here, as an unknown account is ignored, and the item with it', () => {
    expect(eventOpening({ event: 'gone' }, events, [crib])).toBeNull();
    expect(eventOpening({ event: 'gone', item: 'item-crib' }, events, [crib])).toBeNull();
    expect(eventOpening({}, events, [crib])).toBeNull();
  });

  it('keeps the event but buys nothing when the item is not on its plan', () => {
    expect(eventOpening({ event: 'e2', item: 'item-elsewhere' }, events, [crib])).toEqual({ eventId: 'e2', item: null });
  });
});

describe('the fields an item fills in', () => {
  it('takes the name as the note, the estimate as the amount and the item’s category', () => {
    expect(buySeed(crib, 'IDR')).toEqual({ description: 'Crib', amount: '6400000', categoryId: 'cat-tiles' });
  });

  it('leaves Category to the screen when the item names none', () => {
    expect(buySeed(wraps, 'IDR')).toEqual({ description: 'Muslin wraps', amount: '520000' });
  });

  it('writes the estimate in the owner’s currency’s own places', () => {
    expect(buySeed({ ...wraps, estimateMinor: 12_345 }, 'USD').amount).toBe('123.45');
  });
});

describe('the seed, as form fields', () => {
  it('fills in the event, and the note, figure and category of an item', () => {
    expect(seeded({ eventId: 'e1', description: 'Crib', amount: '6400000', categoryId: 'cat-tiles', moneyId: 'wallet' }, accounts)).toEqual({
      moneyId: 'wallet',
      toId: '',
      eventId: 'e1',
      categoryId: 'cat-tiles',
      description: 'Crib',
      amount: '6400000',
    });
  });

  it('drops an account or category this device does not hold, and a category that is not a spending one', () => {
    expect(seeded({ moneyId: 'nowhere', categoryId: 'cat-gone' }, accounts)).toEqual({ moneyId: '', toId: '' });
    expect(seeded({ categoryId: 'cat-salary' }, accounts)).toEqual({ moneyId: '', toId: '' });
    expect(seeded({ categoryId: 'wallet' }, accounts)).toEqual({ moneyId: '', toId: '' });
  });

  it('posts the event with the spending, so the payment is tagged as it is written', () => {
    const draft: FormDraft = { ...emptyForm('book'), ...seeded({ eventId: 'e1', moneyId: 'wallet', categoryId: 'cat-food', amount: '85000', description: 'Lunch' }, accounts) };
    const post = formToPost(draft, accounts);
    expect(post.kind).toBe('post');
    expect(post.kind === 'post' && post.input.eventId).toBe('e1');
  });
});

describe('buying an item, refused before anything is written', () => {
  const buying = (patch: Partial<FormDraft>): FormDraft => ({ ...emptyForm('book'), eventId: 'e1', amount: '6400000', ...patch });

  it('lets an ordinary purchase through', () => {
    expect(buyRefusal(buying({}), 'e1')).toBeNull();
  });

  it('refuses money coming back, which no item can take as its share', () => {
    expect(buyRefusal(buying({ amount: '-6400000' }), 'e1')).toMatch(/figure above nought/);
    expect(buyRefusal(buying({ amount: '−6400000' }), 'e1')).toMatch(/figure above nought/);
  });

  it('refuses a payment moved off the item’s event, or out of the event altogether', () => {
    expect(buyRefusal(buying({ eventId: 'e2' }), 'e1')).toMatch(/own event/);
    expect(buyRefusal(buying({ eventId: '' }), 'e1')).toMatch(/own event/);
  });

  it('refuses anything that is not spending', () => {
    for (const mode of ['income', 'transfer', 'trade'] as const) expect(buyRefusal(buying({ mode }), 'e1')).toMatch(/expense/);
  });
});

describe('the categories offered while an event is set', () => {
  // Invented: the monthly tree's Food, and a renovation set's Tiles and Paint; one archived, one in another set.
  const tree = [
    { id: 'food', name: 'Food', kind: 'expense', subtype: 'category', currency: null, archivedAt: null, systemKey: null },
    { id: 'tiles', name: 'Tiles', kind: 'expense', subtype: 'category', currency: null, archivedAt: null, systemKey: null },
    { id: 'paint', name: 'Paint', kind: 'expense', subtype: 'category', currency: null, archivedAt: null, systemKey: null },
    { id: 'grout', name: 'Grout', kind: 'expense', subtype: 'category', currency: null, archivedAt: '2026-01-01', systemKey: null },
    { id: 'nappies', name: 'Nappies', kind: 'expense', subtype: 'category', currency: null, archivedAt: null, systemKey: null },
  ] as AccountRow[];
  const membership = { tiles: 'reno', paint: 'reno', grout: 'reno', nappies: 'baby' };
  const ids = (rows: AccountRow[]) => rows.map((row) => row.id);

  it('is the monthly tree with no event, or an event that draws on no set', () => {
    expect(ids(offeredCategories(tree, 'expense', membership, () => true))).toEqual(['food']);
    expect(ids(offeredCategories(tree, 'expense', membership, () => true, null))).toEqual(['food']);
  });

  it('is the event’s own set in place of the tree, open categories only, and never another set’s', () => {
    expect(ids(offeredCategories(tree, 'expense', membership, () => true, 'reno'))).toEqual(['tiles', 'paint']);
  });

  it('still narrows by the book the caller keeps', () => {
    expect(ids(offeredCategories(tree, 'expense', membership, (a) => a.id !== 'paint', 'reno'))).toEqual(['tiles']);
  });
});
