import type { EventRow, SharedEventSummary } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { shareEventRows } from './share-events';

const event = (id: string, name: string) => ({ id, name }) as EventRow;
const summary = (eventId: string, sharedWith: number): SharedEventSummary => ({ eventId, people: [], sharedWith });

describe('shareEventRows', () => {
  it('says Not shared for an event with no event book', () => {
    expect(shareEventRows([event('a', 'Lebaran')], {})).toEqual([{ eventId: 'a', name: 'Lebaran', shared: false, value: 'Not shared' }]);
  });

  it('counts the others for a shared one, as the events list does', () => {
    const rows = shareEventRows([event('a', 'Trip'), event('b', 'Wedding')], { a: summary('a', 2), b: summary('b', 1) });
    expect(rows.map((row) => row.value)).toEqual(['Shared with 2 people', 'Shared with 1 person']);
    expect(rows.every((row) => row.shared)).toBe(true);
  });

  it('keeps the order given and mixes shared with not shared', () => {
    const rows = shareEventRows([event('a', 'A'), event('b', 'B')], { b: summary('b', 0) });
    expect(rows.map((row) => [row.name, row.shared, row.value])).toEqual([
      ['A', false, 'Not shared'],
      ['B', true, 'Shared, nobody else in it yet'],
    ]);
  });

  it('is empty when there are no events', () => {
    expect(shareEventRows([], {})).toEqual([]);
  });
});
