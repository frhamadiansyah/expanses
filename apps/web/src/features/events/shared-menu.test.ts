import type { SharedEventView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { sharedEventMenu } from './shared-menu';

const noop = { people: () => undefined, currency: () => undefined, done: () => undefined, leave: () => undefined };
const view = (over: Partial<SharedEventView> = {}): SharedEventView => ({
  eventId: 'ev', bookId: 'b', name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12', currency: 'TRY', finishedAt: null, state: 'active', me: 'p-rina', myName: 'Rina',
  people: [{ personId: 'p-rina', name: 'Rina', initials: 'R', hasApp: true, isMe: true, removed: false, balanceMinor: 0 }],
  categories: [], expenses: [], settlements: [], spentMinor: 0, myShareMinor: 0, payments: [], waiting: [], currencyLocked: false, ...over,
});

describe('the shared event’s ⋯ menu (§6)', () => {
  it('holds People, Currency until the first expense, Done and Leave', () => {
    expect(sharedEventMenu(view(), noop).map((a) => [a.label, !!a.disabled])).toEqual([['People', false], ['Currency', false], ['Done', false], ['Leave', false]]);
  });

  it('greys Currency once something is spent, and Leave while the balance is not zero, saying why', () => {
    const menu = sharedEventMenu(view({ currencyLocked: true, people: [{ personId: 'p-rina', name: 'Rina', initials: 'R', hasApp: true, isMe: true, removed: false, balanceMinor: -500 }] }), noop);
    expect(menu.find((a) => a.key === 'currency')).toMatchObject({ disabled: true, detail: 'Fixed once something is spent' });
    expect(menu.find((a) => a.key === 'leave')).toMatchObject({ disabled: true, detail: "Rina's balance is not zero yet" });
  });

  it('offers Reopen on a Done event, and no Currency (refused until it is reopened)', () => {
    const menu = sharedEventMenu(view({ finishedAt: '2026-10-13T00:00:00Z' }), noop);
    expect(menu.find((a) => a.key === 'done')?.label).toBe('Reopen');
    expect(menu.map((a) => a.key)).toEqual(['people', 'done', 'leave']);
  });

  it('keeps People alone once this person is no longer in the event (I5)', () => {
    expect(sharedEventMenu(view({ state: 'unshared' }), noop).map((a) => a.key)).toEqual(['people']);
  });
});
