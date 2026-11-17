import type { DraftRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { deskState, fromTag, newestFirst, paidWithOf, peekAfterGone, queueCounts, queueKey, whenText } from './review-desk-model';

const draft = (over: Partial<DraftRow> = {}): DraftRow => ({
  id: 'd1',
  source: 'notification',
  kind: 'expense',
  status: 'pending',
  rawPayload: null,
  occurredOn: '2026-11-17',
  description: 'SUPERINDO',
  amountMinor: 112_300,
  currency: 'IDR',
  accountId: 'bca',
  toAccountId: null,
  categoryAccountId: 'groceries',
  cardId: null,
  sourceId: null,
  captureIds: ['c1'],
  imageFile: null,
  reading: null,
  mergedInto: null,
  confidence: 90,
  externalRef: null,
  transactionId: null,
  ...over,
});

const state = (over: Partial<DraftRow> = {}, guesses: Record<string, string | null> = {}, shared: Record<string, unknown> = {}) => deskState(draft(over), null, guesses, shared);

describe('deskState', () => {
  it('a draft with an account, a category and a sure figure is ready', () => {
    expect(state()).toEqual({ needsCategory: false, needsAccount: false, checkAmount: false, onForm: false, complete: true, ready: true });
  });

  it('a missing category holds it back — until one is filled, which makes it ready', () => {
    expect(state({ categoryAccountId: null })).toMatchObject({ needsCategory: true, ready: false, complete: false });
    expect(state({ categoryAccountId: 'groceries' })).toMatchObject({ needsCategory: false, ready: true });
  });

  it('the category the merchant’s history guesses counts, as the phone’s row and swipe count it', () => {
    expect(state({ categoryAccountId: null }, { d1: 'groceries' })).toMatchObject({ needsCategory: false, ready: true });
    expect(state({ categoryAccountId: null }, { d1: null })).toMatchObject({ needsCategory: true });
  });

  it('a missing account, or a transfer’s missing destination, needs an account', () => {
    expect(state({ accountId: null })).toMatchObject({ needsAccount: true, ready: false });
    expect(state({ kind: 'transfer', categoryAccountId: null, toAccountId: null })).toMatchObject({ needsAccount: true, needsCategory: false, ready: false });
    expect(state({ kind: 'transfer', categoryAccountId: null, toAccountId: 'gopay' })).toMatchObject({ needsAccount: false, needsCategory: false, ready: true });
  });

  it('a transfer to the account it came from is not complete', () => {
    expect(state({ kind: 'transfer', categoryAccountId: null, toAccountId: 'bca' })).toMatchObject({ complete: false, ready: false });
  });

  it('no figure is incomplete; a figure the reader was unsure of is complete for the peek but not ready', () => {
    expect(state({ amountMinor: 0 })).toMatchObject({ checkAmount: true, complete: false, ready: false });
    expect(state({ confidence: 40 })).toMatchObject({ checkAmount: true, complete: true, ready: false });
  });

  it('one captured for a shared event is recorded on its form, never from the table', () => {
    expect(state({ eventId: 'trip' }, {}, { trip: {} })).toMatchObject({ onForm: true, complete: true, ready: false });
    // A private event is no such question.
    expect(state({ eventId: 'trip' }, {}, {})).toMatchObject({ onForm: false, ready: true });
  });
});

describe('queueCounts', () => {
  it('counts every row once for To review, and each need apart (a row can need both)', () => {
    const states = [state(), state({ id: 'd2', categoryAccountId: null }), state({ id: 'd3', categoryAccountId: null, accountId: null }), state({ id: 'd4', amountMinor: 0, categoryAccountId: null })];
    expect(queueCounts(states)).toEqual({ toReview: 4, ready: 1, needCategory: 3, needAccount: 1, checkAmount: 1 });
  });
});

describe('fromTag', () => {
  it('names a capture as the phone does, and any other row by the door it came in by', () => {
    expect(fromTag({ source: 'notification' }, 'sms')).toEqual({ word: 'SMS', type: 'sms' });
    expect(fromTag({ source: 'email' }, 'email')).toEqual({ word: 'Email', type: 'email' });
    expect(fromTag({ source: 'csv' }, null)).toEqual({ word: 'Import', type: null });
    expect(fromTag({ source: 'manual' }, null)).toEqual({ word: 'By hand', type: null });
  });
});

describe('whenText', () => {
  const now = new Date(2026, 10, 17, 22, 0);
  const at = (h: number, m: number, day = 17) => new Date(2026, 10, day, h, m).toISOString();

  it('says Today and Yesterday with the time a capture arrived', () => {
    expect(whenText({ occurredOn: '2026-11-17', createdAt: at(8, 12) }, true, now)).toBe('Today 08:12');
    expect(whenText({ occurredOn: '2026-11-16', createdAt: at(21, 3, 16) }, true, now)).toBe('Yesterday 21:03');
  });

  it('an older day reads as its date; an import, or a capture noticed on another day, has no time', () => {
    expect(whenText({ occurredOn: '2026-11-14', createdAt: at(9, 0, 14) }, true, now)).toBe('14 Nov 09:00');
    expect(whenText({ occurredOn: '2026-11-17', createdAt: at(8, 12) }, false, now)).toBe('Today');
    expect(whenText({ occurredOn: '2026-11-15', createdAt: at(8, 12) }, true, now)).toBe('15 Nov');
  });
});

describe('newestFirst', () => {
  it('runs by day, newest first, then by when each arrived', () => {
    const rows = [
      { id: 'a', occurredOn: '2026-11-16', createdAt: '2026-11-16T10:00:00Z' },
      { id: 'b', occurredOn: '2026-11-17', createdAt: '2026-11-17T01:00:00Z' },
      { id: 'c', occurredOn: '2026-11-17', createdAt: '2026-11-17T03:00:00Z' },
    ];
    expect(newestFirst(rows).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('paidWithOf', () => {
  const accounts = [
    { id: 'visa', name: 'BCA Visa' },
    { id: 'bca', name: 'BCA' },
  ];
  const cards = [
    { id: 'c1', accountId: 'visa', last4: '1467', archived: false },
    { id: 'c2', accountId: 'visa', last4: '9921', archived: false },
    { id: 'c3', accountId: 'bca', last4: '0042', archived: false },
  ];

  it('names the account with the card that paid, or the account’s only card', () => {
    expect(paidWithOf('visa', 'c2', accounts, cards)).toEqual({ name: 'BCA Visa', last4: '9921' });
    expect(paidWithOf('visa', null, accounts, cards)).toEqual({ name: 'BCA Visa', last4: null });
    expect(paidWithOf('bca', null, accounts, cards)).toEqual({ name: 'BCA', last4: '0042' });
    expect(paidWithOf(null, null, accounts, cards)).toBeNull();
  });
});

describe('peekAfterGone', () => {
  it('moves to the row that took the gone row’s place, else the one before, else closes', () => {
    expect(peekAfterGone(['b', 'c'], 0)).toBe('b');
    expect(peekAfterGone(['a', 'b'], 2)).toBe('b');
    expect(peekAfterGone([], 0)).toBeNull();
  });
});

describe('queueKey', () => {
  it('Return records, ⌫ and Delete discard, the arrows step, Esc closes', () => {
    expect(queueKey('Enter')).toBe('record');
    expect(queueKey('Backspace')).toBe('discard');
    expect(queueKey('Delete')).toBe('discard');
    expect(queueKey('ArrowUp')).toBe('up');
    expect(queueKey('ArrowDown')).toBe('down');
    expect(queueKey('Escape')).toBe('close');
    expect(queueKey('a')).toBeNull();
  });
});
