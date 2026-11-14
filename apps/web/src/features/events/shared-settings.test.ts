import type { SharedEventView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { askBeforeOnePot, categoriesValue, peopleValue, sharedSettings, stopSplittingText } from './shared-settings';

/* A shared trip's Settings page (owner, 14 Nov 2026). Invented trip and names; no line says "you". */

const TODAY = '2026-10-08';
const me = { personId: 'p-sari', name: 'Sari', initials: 'S', hasApp: true, isMe: true, removed: false, balanceMinor: 0 };
const dimas = { personId: 'p-dimas', name: 'Dimas', initials: 'D', hasApp: true, isMe: false, removed: false, balanceMinor: 0 };
const view = (over: Partial<SharedEventView> = {}): SharedEventView => ({
  eventId: 'ev', bookId: 'b', name: 'Seaside', startsOn: '2026-10-05', endsOn: '2026-10-12', currency: 'IDR', finishedAt: null, splitCosts: true, planOff: false, state: 'active',
  me: 'p-sari', myName: 'Sari', people: [me, dimas], categories: [], expenses: [], settlements: [], spentMinor: 0, myShareMinor: 0, payments: [], waiting: [],
  currencyLocked: false, transfers: [], ...over,
});

describe('the shared trip’s Settings', () => {
  it('has both switches, People and Categories, Mark as done, and Leave last', () => {
    const s = sharedSettings(view(), TODAY);
    expect(s.switches).toEqual({ shown: true, disabled: false });
    expect(s.categories).toBe(true);
    expect(s.done).toEqual({ label: 'Mark as done', finished: false, footer: 'Moves Seaside to Past. It can be reopened.' });
    expect(s.leave).toEqual({ label: 'Leave Seaside', disabled: false, footer: null });
    expect(s.deleteCopy).toBeNull();
  });

  it('a Done trip greys the switches and offers Reopen', () => {
    const s = sharedSettings(view({ finishedAt: '2026-10-07T03:00:00Z' }), TODAY);
    expect(s.switches.disabled).toBe(true);
    expect(s.done).toMatchObject({ label: 'Reopen', finished: true, footer: expect.stringMatching(/^Done on 7 Oct\. Reopening moves it back to Now and next\.$/) });
  });

  it('greys Leave while the balance is not zero, saying why — and in one pot, how to see it', () => {
    const owing = [{ ...me, balanceMinor: -50_000 }, { ...dimas, balanceMinor: 50_000 }];
    expect(sharedSettings(view({ people: owing }), TODAY).leave).toEqual({ label: 'Leave Seaside', disabled: true, footer: "Sari's balance is not zero yet." });
    expect(sharedSettings(view({ people: owing, splitCosts: false }), TODAY).leave?.footer).toBe("Sari's balance is not zero yet. Split costs on shows it.");
  });

  it('a copy this person is no longer in keeps People and Delete this copy; one waiting for an invite, People alone', () => {
    expect(sharedSettings(view({ state: 'unshared' }), TODAY)).toMatchObject({ switches: { shown: false }, categories: false, done: null, leave: null, deleteCopy: { label: 'Delete this copy', disabled: false } });
    expect(sharedSettings(view({ state: 'unshared', people: [{ ...me, balanceMinor: 50_000 }] }), TODAY).deleteCopy).toMatchObject({ disabled: true, footer: expect.stringMatching(/^Sari's balance is \+/) });
    expect(sharedSettings(view({ state: 'needs_invite' }), TODAY)).toMatchObject({ deleteCopy: null, leave: null, done: null });
  });

  it('asks before one pot only while someone owes, naming who owes whom', () => {
    expect(askBeforeOnePot(view())).toBe(false);
    const owing = view({ people: [{ ...me, balanceMinor: 120_000 }, { ...dimas, balanceMinor: -120_000 }], payments: [{ fromPersonId: 'p-dimas', fromName: 'Dimas', toPersonId: 'p-sari', toName: 'Sari', amountMinor: 120_000 }] });
    expect(askBeforeOnePot(owing)).toBe(true);
    expect(stopSplittingText(owing)).toMatch(/^Dimas owes Sari Rp\s?120\.000 now\. With splitting off, nobody owes anything on this trip\. The splits are kept; switching back on brings them back\.$/);
  });

  it('lists the people still in it and counts the open categories', () => {
    expect(peopleValue(view({ people: [me, dimas, { ...dimas, personId: 'p-x', name: 'Wulan', removed: true }] }))).toBe('Sari, Dimas');
    expect(categoriesValue(view())).toBe('None yet');
    expect(categoriesValue(view({ categories: [{ categoryId: 'a', name: 'Food', icon: null, archived: false }, { categoryId: 'b', name: 'Old', icon: null, archived: true }] }))).toBe('1');
  });

  it('never says "you"', () => {
    const owing = view({ people: [{ ...me, balanceMinor: 1 }], payments: [{ fromPersonId: 'p-dimas', fromName: 'Dimas', toPersonId: 'p-sari', toName: 'Sari', amountMinor: 1 }] });
    const words = JSON.stringify([sharedSettings(owing, TODAY), sharedSettings(view({ splitCosts: false, people: [{ ...me, balanceMinor: 1 }] }), TODAY), stopSplittingText(owing)]);
    expect(words).not.toMatch(/\byou(r)?\b/i);
  });
});
