import { describe, expect, it } from 'vitest';
import { homesOf, movedText, rowsToMove } from './event-tagging';

const names: Record<string, string> = { trip: 'Bali trip', wedding: 'Wedding' };
const nameOf = (id: string) => names[id];

describe('rowsToMove', () => {
  const ticked = [
    { id: 'a', eventId: null },
    { id: 'b', eventId: 'trip' },
    { id: 'c', eventId: 'wedding' },
  ];

  it('adds every row not already in the event, taking one out of another event as it goes', () => {
    expect(rowsToMove(ticked, 'trip').map((row) => row.id)).toEqual(['a', 'c']);
  });

  it('removes only rows that were in an event', () => {
    expect(rowsToMove(ticked, null).map((row) => row.id)).toEqual(['b', 'c']);
    expect(rowsToMove([{ id: 'a', eventId: null }], null)).toEqual([]);
  });
});

describe('movedText', () => {
  it('names the event added to, and counts in words', () => {
    expect(movedText([{ id: 'a', eventId: null }], 'trip', nameOf)).toBe('1 transaction added to Bali trip');
    expect(movedText([{ id: 'a', eventId: null }, { id: 'c', eventId: 'wedding' }], 'trip', nameOf)).toBe('2 transactions added to Bali trip');
  });

  it('names the one event removed from, and only when there was one', () => {
    expect(movedText([{ id: 'b', eventId: 'trip' }, { id: 'd', eventId: 'trip' }], null, nameOf)).toBe('2 transactions removed from Bali trip');
    expect(movedText([{ id: 'b', eventId: 'trip' }, { id: 'c', eventId: 'wedding' }], null, nameOf)).toBe('2 transactions removed from their events');
  });

  it('says "the event" for one it cannot name', () => {
    expect(movedText([{ id: 'a', eventId: null }], 'gone', nameOf)).toBe('1 transaction added to the event');
  });
});

describe('homesOf', () => {
  it('sends each row back to the event it came from, one group per event', () => {
    const homes = homesOf([
      { id: 'a', eventId: null },
      { id: 'c', eventId: 'wedding' },
      { id: 'e', eventId: null },
    ]);
    expect(homes).toEqual(
      new Map<string | null, string[]>([
        [null, ['a', 'e']],
        ['wedding', ['c']],
      ]),
    );
  });
});
