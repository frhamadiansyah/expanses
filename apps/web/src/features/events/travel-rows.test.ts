import type { EventRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { travelEntries } from './travel-rows';

const event = (id: string, startsOn: string, endsOn: string, extra: Partial<EventRow> = {}) => ({ id, name: id, startsOn, endsOn, finishedAt: null, ...extra }) as EventRow;
const lines = (events: EventRow[], today = '2026-10-10') => travelEntries(events, today).map((e) => `${e.event.id}: ${e.line}`);

describe('travelEntries', () => {
  it('says which day of the trip it is while it runs', () => {
    expect(lines([event('bali', '2026-10-08', '2026-10-13')])).toEqual(['bali: Today · day 3 of 6']);
  });
  it('counts down to a trip starting within a week, and leaves a later one out', () => {
    expect(lines([event('near', '2026-10-13', '2026-10-15'), event('far', '2026-10-18', '2026-10-20')])).toEqual(['near: Starts in 3 days']);
    expect(lines([event('next', '2026-10-11', '2026-10-12')])).toEqual(['next: Starts tomorrow']);
  });
  it('leaves out one that ended or was finished, and puts running first, two at most', () => {
    const all = [
      event('old', '2026-10-01', '2026-10-05'),
      event('done', '2026-10-09', '2026-10-12', { finishedAt: '2026-10-10' }),
      event('soon', '2026-10-12', '2026-10-14'),
      event('now', '2026-10-10', '2026-10-10'),
      event('also', '2026-10-13', '2026-10-14'),
    ];
    expect(lines(all)).toEqual(['now: Today · day 1 of 1', 'soon: Starts in 2 days']);
  });
});
