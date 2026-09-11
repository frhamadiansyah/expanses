import { describe, expect, it } from 'vitest';
import { cyclesCovering } from './purchase-points';

describe('cyclesCovering', () => {
  it('returns each statement cycle containing the dates once, in date order', () => {
    expect(cyclesCovering(['2026-09-28', '2026-09-05', '2026-09-20'], 'statement', 25)).toEqual([
      { start: '2026-08-26', end: '2026-09-25' },
      { start: '2026-09-26', end: '2026-10-25' },
    ]);
  });

  it('uses calendar months for calendar programs', () => {
    expect(cyclesCovering(['2026-09-30', '2026-09-01'], 'calendar', 1)).toEqual([{ start: '2026-09-01', end: '2026-09-30' }]);
  });
});
