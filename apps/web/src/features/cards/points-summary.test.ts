import { describe, expect, it } from 'vitest';
import { pointsSummary } from './points-summary';

describe('pointsSummary', () => {
  it('says the estimate once when it is only this cycle', () => {
    expect(pointsSummary(450, 365, 365)).toBe('450 posted · +365 this cycle');
  });

  it('keeps the estimated total when older points are still waiting to post', () => {
    expect(pointsSummary(450, 833, 365)).toBe('450 posted · 833 estimated · +365 this cycle');
  });

  it('shows the estimate alone when there is no cycle to speak of', () => {
    expect(pointsSummary(0, 120, null)).toBe('0 posted · 120 estimated');
  });
});
