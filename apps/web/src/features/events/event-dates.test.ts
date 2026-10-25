import { describe, expect, it } from 'vitest';
import { eventDates } from './EventsPage';

describe('eventDates', () => {
  it('says the month once inside a month, twice across two, and one date for a day', () => {
    expect(eventDates({ startsOn: '2026-10-21', endsOn: '2026-10-28' })).toBe('21 – 28 Oct 2026');
    expect(eventDates({ startsOn: '2026-10-28', endsOn: '2026-11-02' })).toBe('28 Oct – 2 Nov 2026');
    expect(eventDates({ startsOn: '2026-10-21', endsOn: '2026-10-21' })).toBe('21 Oct 2026');
  });
});
