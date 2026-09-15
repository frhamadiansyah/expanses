import { describe, expect, it } from 'vitest';
import { cycleBack, dueDateAfter, dueIn } from './statement-dates';

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
