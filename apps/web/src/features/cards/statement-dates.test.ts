import { describe, expect, it } from 'vitest';
import { cycleBack, dueDateAfter } from './statement-dates';

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
