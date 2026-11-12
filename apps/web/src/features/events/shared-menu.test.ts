import type { SharedEventView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { sharedEventMenu } from './shared-menu';

const noop = { people: () => undefined, categories: () => undefined, done: () => undefined, leave: () => undefined, deleteCopy: () => undefined };
const view = (over: Partial<SharedEventView> = {}): SharedEventView => ({
  eventId: 'ev', bookId: 'b', name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12', currency: 'TRY', finishedAt: null, state: 'active', me: 'p-rina', myName: 'Rina',
  people: [{ personId: 'p-rina', name: 'Rina', initials: 'R', hasApp: true, isMe: true, removed: false, balanceMinor: 0 }],
  categories: [], expenses: [], settlements: [], spentMinor: 0, myShareMinor: 0, payments: [], waiting: [], currencyLocked: false, ...over,
});

describe('the shared event’s ⋯ menu (§6)', () => {
  it('holds People, Categories, Done and Leave, and no Currency (chosen when shared)', () => {
    expect(sharedEventMenu(view(), noop).map((a) => [a.label, !!a.disabled])).toEqual([['People', false], ['Categories', false], ['Done', false], ['Leave', false]]);
  });

  it('greys Leave while the balance is not zero, saying why', () => {
    const menu = sharedEventMenu(view({ people: [{ personId: 'p-rina', name: 'Rina', initials: 'R', hasApp: true, isMe: true, removed: false, balanceMinor: -500 }] }), noop);
    expect(menu.find((a) => a.key === 'leave')).toMatchObject({ disabled: true, detail: "Rina's balance is not zero yet" });
  });

  it('offers Reopen on a Done event', () => {
    const menu = sharedEventMenu(view({ finishedAt: '2026-10-13T00:00:00Z' }), noop);
    expect(menu.find((a) => a.key === 'done')?.label).toBe('Reopen');
    expect(menu.map((a) => a.key)).toEqual(['people', 'categories', 'done', 'leave']);
  });

  it('keeps People, and offers Delete this copy, once this person is no longer in the event (I5)', () => {
    const menu = sharedEventMenu(view({ state: 'unshared' }), noop);
    expect(menu.map((a) => a.key)).toEqual(['people', 'delete-copy']);
    expect(menu.find((a) => a.key === 'delete-copy')).toMatchObject({ label: 'Delete this copy', destructive: true });
    expect(menu.find((a) => a.key === 'delete-copy')?.disabled).toBeFalsy();
  });

  it('a copy waiting for an invite keeps People alone: its person is still in the event (review minor 2)', () => {
    expect(sharedEventMenu(view({ state: 'needs_invite' }), noop).map((a) => a.key)).toEqual(['people']);
  });

  it('greys Delete this copy while the balance is not zero, with the amount (review I1)', () => {
    const owing = view({ state: 'unshared', people: [{ personId: 'p-rina', name: 'Rina', initials: 'R', hasApp: true, isMe: true, removed: false, balanceMinor: 50_000 }] });
    expect(sharedEventMenu(owing, noop).find((a) => a.key === 'delete-copy')).toMatchObject({ disabled: true, detail: expect.stringMatching(/^Rina's balance is \+/) });
  });

  it('never offers Delete this copy on an event this person is still in (that is Leave)', () => {
    expect(sharedEventMenu(view(), noop).map((a) => a.key)).not.toContain('delete-copy');
    expect(sharedEventMenu(view({ finishedAt: '2026-10-13T00:00:00Z' }), noop).map((a) => a.key)).not.toContain('delete-copy');
  });
});
