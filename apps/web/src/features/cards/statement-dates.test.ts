import { describe, expect, it } from 'vitest';
import { cycleBack, cycleDueIn, dueDateAfter, dueIn, statementSearch } from './statement-dates';

describe('statement dates', () => {
  it('steps back through statements from the one today is in', () => {
    expect(cycleBack('2026-09-15', 20, 0)).toEqual({ start: '2026-08-21', end: '2026-09-20' });
    expect(cycleBack('2026-09-15', 20, 1)).toEqual({ start: '2026-07-21', end: '2026-08-20' });
    expect(cycleBack('2026-01-10', 31, 1)).toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });

  it('puts the due date on the first due day after the statement', () => {
    expect(dueDateAfter('2026-08-20', 5)).toBe('2026-09-05');
    expect(dueDateAfter('2026-08-05', 25)).toBe('2026-08-25');
    expect(dueDateAfter('2026-01-20', 30)).toBe('2026-01-30');
    expect(dueDateAfter('2026-01-31', 30)).toBe('2026-02-28');
    expect(dueDateAfter('2026-12-20', 10)).toBe('2027-01-10');
  });
});

describe('dueIn', () => {
  it('counts down to the due date and says when it has passed', () => {
    expect(dueIn('2026-09-01', '2026-09-05')).toEqual({ text: 'in 4 days', tone: 'calm' });
    expect(dueIn('2026-09-02', '2026-09-05')).toEqual({ text: 'in 3 days', tone: 'soon' });
    expect(dueIn('2026-09-04', '2026-09-05')).toEqual({ text: 'tomorrow', tone: 'soon' });
    expect(dueIn('2026-09-05', '2026-09-05')).toEqual({ text: 'today', tone: 'soon' });
    expect(dueIn('2026-09-06', '2026-09-05')).toEqual({ text: '1 day late', tone: 'late' });
    expect(dueIn('2026-10-01', '2026-09-05')).toEqual({ text: '26 days late', tone: 'late' });
  });
});

describe('cycleDueIn', () => {
  it('the statement whose due day falls in the month', () => {
    expect(cycleDueIn('2026-11', 31, 18)).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(cycleDueIn('2026-11', 20, 5)).toEqual({ start: '2026-09-21', end: '2026-10-20' });
    expect(cycleDueIn('2026-11', 5, 25)).toEqual({ start: '2026-10-06', end: '2026-11-05' });
    expect(cycleDueIn('2027-01', 20, 10)).toEqual({ start: '2026-11-21', end: '2026-12-20' });
  });
});

describe('statementSearch', () => {
  it('keeps which statement is on screen in the address, so the way back from paying lands on it again', () => {
    expect(statementSearch({ back: 2 })).toEqual({ back: 2 });
    expect(statementSearch({ back: '1' })).toEqual({ back: 1 });
    // The current statement is the address with nothing in it.
    for (const back of [0, -1, 1.5, 'x', undefined]) expect(statementSearch({ back })).toEqual({});
  });
});
